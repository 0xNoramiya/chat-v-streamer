import {
  RefreshingAuthProvider,
  exchangeCode,
  getTokenInfo,
  type AccessToken,
} from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { parseCommand } from '../../court/commands.js';
import type { Settings, User } from '../../../web/src/shared/types.js';
import type { TwitchAdapter, StreamInfo, TwitchExecution } from './types.js';
const tokenSchema = z.object({
  userId: z.string(),
  token: z.object({
    accessToken: z.string(),
    refreshToken: z.string().nullable(),
    scope: z.array(z.string()),
    expiresIn: z.number().nullable(),
    obtainmentTimestamp: z.number(),
  }),
});
type Account = z.infer<typeof tokenSchema>;
type AccountRole = 'broadcaster' | 'bot';
export function protectedUser(user: User, broadcasterId: string) {
  return user.id === broadcasterId || !!(user.broadcaster || user.mod || user.vip);
}
export class RealTwitch implements TwitchAdapter {
  execution(): TwitchExecution {
    return {
      mode: config.DRY_RUN ? 'dry_run' : 'live',
      channelId: this.accounts.broadcaster?.userId ?? null,
    };
  }
  status = 'not connected';
  eventsubStatus = 'not connected';
  botId?: string;
  onStreamInfo?: (info: StreamInfo) => void;
  onMessage?: (user: User, text: string) => void;
  onRedemption?: (user: User, text: string) => void;
  private provider: RefreshingAuthProvider;
  private api: ApiClient;
  private listener?: EventSubWsListener;
  private accounts: Partial<Record<AccountRole, Account>> = {};
  private states = new Map<string, { role: AccountRole; expires: number }>();
  private queue: Promise<void> = Promise.resolve();
  private lastChat = 0;
  private queued = 0;
  private seen = new Set<string>();
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private evidence = {
    refreshes: 0,
    refreshFailures: 0,
    eventsubMessages: 0,
    observedCommands: { filings: 0, cosigns: 0, votes: 0, controls: 0 },
    dryRunActions: 0,
    liveActionAttempts: 0,
    stream: 'unverified' as 'unverified' | 'live' | 'offline',
  };
  diagnostics() {
    return {
      broadcasterTokenLoaded: !!this.accounts.broadcaster,
      botTokenLoaded: !!this.accounts.bot,
      ...structuredClone(this.evidence),
    };
  }
  constructor(
    private log: (kind: string, text: string) => void,
    private settings: () => Settings,
  ) {
    this.provider = new RefreshingAuthProvider({
      clientId: config.TWITCH_CLIENT_ID,
      clientSecret: config.TWITCH_CLIENT_SECRET,
      redirectUri: config.TWITCH_REDIRECT_URI,
    });
    this.api = new ApiClient({ authProvider: this.provider, logger: { minLevel: 'error' } });
    this.provider.onRefresh((userId, token) => {
      this.evidence.refreshes++;
      for (const role of ['broadcaster', 'bot'] as const)
        if (this.accounts[role]?.userId === userId) this.accounts[role] = { userId, token };
      this.save();
    });
    this.provider.onRefreshFailure(() => {
      this.evidence.refreshFailures++;
      this.status = 'auth expired';
      this.log(
        'twitch',
        'Token refresh failed. Reconnect the affected Twitch account in Diagnostics.',
      );
    });
  }
  private save() {
    mkdirSync('data', { recursive: true });
    writeFileSync('data/tokens.json.tmp', JSON.stringify(this.accounts, null, 2), { mode: 0o600 });
    renameSync('data/tokens.json.tmp', 'data/tokens.json');
  }
  async connect() {
    if (!config.TWITCH_CLIENT_ID || !config.TWITCH_CLIENT_SECRET) {
      this.status = 'credentials missing';
      return;
    }
    try {
      if (existsSync('data/tokens.json')) {
        const data = z
          .object({ broadcaster: tokenSchema.optional(), bot: tokenSchema.optional() })
          .parse(JSON.parse(readFileSync('data/tokens.json', 'utf8')));
        this.accounts = data;
        for (const role of ['broadcaster', 'bot'] as const) {
          const a = data[role];
          if (a) this.provider.addUser(a.userId, a.token, [role]);
        }
      }
      await this.listen();
    } catch {
      this.status = 'auth unavailable';
      this.log('twitch', 'Could not restore Twitch auth. Connect broadcaster in Diagnostics.');
    }
  }
  private async listen() {
    this.listener?.stop();
    const broadcaster = this.accounts.broadcaster;
    if (!broadcaster) {
      this.status = 'connect broadcaster';
      return;
    }
    this.status = 'connected';
    const reader = this.accounts.bot?.userId ?? broadcaster.userId;
    this.botId = this.accounts.bot?.userId;
    const listener = new EventSubWsListener({ apiClient: this.api, logger: { minLevel: 'error' } });
    this.listener = listener;
    listener.onUserSocketConnect(() => {
      this.eventsubStatus = 'connected';
      this.log('twitch', 'EventSub WebSocket connected.');
    });
    listener.onUserSocketDisconnect(() => {
      this.eventsubStatus = 'reconnecting';
      this.log('twitch', 'EventSub disconnected; reconnecting.');
    });
    listener.onSubscriptionCreateFailure(() => {
      this.eventsubStatus = 'subscription failed';
      this.log('twitch', 'EventSub subscription failed. Check chat scopes and mod the bot.');
      clearTimeout(this.retry);
      if (!this.closed)
        this.retry = setTimeout(() => {
          void this.listen().catch(() =>
            this.log('twitch', 'Subscription retry failed. Reconnect broadcaster.'),
          );
        }, 15000);
    });
    listener.onChannelChatMessage(broadcaster.userId, reader, (e) => {
      if (this.seen.has(e.messageId)) return;
      if (this.seen.size > 3000) this.seen.clear();
      this.seen.add(e.messageId);
      if (e.chatterId === this.botId) return;
      this.evidence.eventsubMessages++;
      const command = parseCommand(e.messageText);
      if (command?.type === 'sue') this.evidence.observedCommands.filings++;
      if (command?.type === 'cosign') this.evidence.observedCommands.cosigns++;
      if (command?.type === 'vote') this.evidence.observedCommands.votes++;
      if (command && ['court', 'approve', 'veto', 'mistrial', 'strike'].includes(command.type))
        this.evidence.observedCommands.controls++;
      this.onMessage?.(
        {
          id: e.chatterId,
          login: e.chatterName,
          broadcaster: e.hasBadge('broadcaster') || e.chatterId === broadcaster.userId,
          mod: e.hasBadge('moderator'),
          vip: e.hasBadge('vip'),
        },
        e.messageText,
      );
    });
    if (this.settings().channelPoints) {
      listener.onChannelRedemptionAdd(broadcaster.userId, (e) => {
        if (e.rewardTitle === 'File a lawsuit')
          this.onRedemption?.(
            { id: e.userId, login: e.userName, broadcaster: e.userId === broadcaster.userId },
            e.input,
          );
      });
    }
    listener.start();
    this.eventsubStatus = 'connecting';
  }
  registerAuth(app: Express) {
    for (const role of ['broadcaster', 'bot'] as const)
      app.get(`/auth/${role}`, (_req, res) => {
        if (!config.TWITCH_CLIENT_ID || !config.TWITCH_CLIENT_SECRET)
          return res
            .status(400)
            .send('Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env, then restart.');
        for (const [key, s] of this.states) if (s.expires < Date.now()) this.states.delete(key);
        const state = randomBytes(32).toString('hex');
        this.states.set(state, { role, expires: Date.now() + 600000 });
        res.cookie('court_oauth_state', state, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 600000,
          path: '/auth',
        });
        const scopes =
          role === 'bot'
            ? ['user:read:chat', 'user:write:chat', 'user:bot']
            : [
                'channel:manage:broadcast',
                'clips:edit',
                'moderator:manage:banned_users',
                'channel:bot',
                'user:read:chat',
                'user:write:chat',
                'moderation:read',
                'channel:read:vips',
                ...(this.settings().polls ? ['channel:manage:polls'] : []),
                ...(this.settings().channelPoints ? ['channel:read:redemptions'] : []),
              ];
        res.redirect(
          'https://id.twitch.tv/oauth2/authorize?' +
            new URLSearchParams({
              client_id: config.TWITCH_CLIENT_ID,
              redirect_uri: config.TWITCH_REDIRECT_URI,
              response_type: 'code',
              scope: scopes.join(' '),
              state,
              force_verify: 'true',
            }),
        );
      });
    app.get('/auth/callback', async (req, res) => {
      const body = z.object({ state: z.string(), code: z.string() }).safeParse(req.query);
      if (!body.success)
        return res
          .status(400)
          .send('Twitch authorization denied or missing code. Retry from the panel.');
      const state = this.states.get(body.data.state),
        cookie = req.headers.cookie
          ?.split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('court_oauth_state='))
          ?.slice('court_oauth_state='.length);
      this.states.delete(body.data.state);
      res.clearCookie('court_oauth_state', { path: '/auth' });
      if (!state || state.expires < Date.now() || cookie !== body.data.state)
        return res.status(400).send('Expired or invalid OAuth state. Retry from the panel.');
      try {
        const token: AccessToken = await exchangeCode(
          config.TWITCH_CLIENT_ID,
          config.TWITCH_CLIENT_SECRET,
          body.data.code,
          config.TWITCH_REDIRECT_URI,
        );
        const info = await getTokenInfo(token.accessToken);
        if (!info.userId) throw Error('User token required');
        if (
          state.role === 'broadcaster' &&
          config.TWITCH_CHANNEL_LOGIN &&
          info.userName?.toLowerCase() !== config.TWITCH_CHANNEL_LOGIN.toLowerCase()
        )
          return res
            .status(400)
            .send(
              'This broadcaster does not match TWITCH_CHANNEL_LOGIN. Connect the configured account.',
            );
        if (state.role === 'bot' && info.userId === this.accounts.broadcaster?.userId)
          return res
            .status(400)
            .send('Use a separate Twitch account for the bot, or skip bot auth.');
        this.accounts[state.role] = { userId: info.userId, token };
        this.provider.addUser(info.userId, token, [state.role]);
        this.save();
        await this.listen();
        res.redirect(new URL('/panel', config.TWITCH_REDIRECT_URI).toString());
      } catch {
        this.log('twitch', 'OAuth exchange failed; no credentials were logged.');
        res
          .status(400)
          .send(
            'Twitch authorization failed. Check client credentials and redirect URI, then retry.',
          );
      }
    });
  }
  private broadcaster() {
    const id = this.accounts.broadcaster?.userId;
    if (!id) throw Error('Connect the Twitch broadcaster first.');
    return id;
  }
  private async action(name: string, fn: () => Promise<unknown>) {
    if (config.DRY_RUN) {
      this.evidence.dryRunActions++;
      this.log('twitch', `DRY_RUN ${name}`);
      return;
    }
    this.evidence.liveActionAttempts++;
    await fn();
    this.log('twitch', name);
  }
  async sendChat(text: string) {
    if (this.queued >= 40) {
      this.log('twitch', 'Outgoing chat queue full; message dropped.');
      return;
    }
    this.queued++;
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const wait = Math.max(0, 1500 - (Date.now() - this.lastChat));
        if (wait) await new Promise<void>((resolve) => setTimeout(resolve, wait));
        if (this.closed) return;
        this.lastChat = Date.now();
        await this.action(`sendChat: ${text.slice(0, 500)}`, async () => {
          const id = this.broadcaster(),
            sender = this.accounts.bot?.userId ?? id;
          await this.api.asUser(sender, (ctx) => ctx.chat.sendChatMessage(id, text.slice(0, 500)));
        });
      })
      .catch(() =>
        this.log('twitch', 'Chat send failed. Check user:write:chat and bot permissions.'),
      )
      .finally(() => {
        this.queued--;
      });
    this.queue = task;
    await task;
  }
  async setTitle(text: string) {
    await this.action(`setTitle: ${text.slice(0, 140)}`, () =>
      this.api.asUser(this.broadcaster(), (ctx) =>
        ctx.channels.updateChannelInfo(this.broadcaster(), { title: text.slice(0, 140) }),
      ),
    );
  }
  async timeout(user: User, seconds: number, reason: string, active = () => true) {
    if (!active()) return;
    const id = this.accounts.broadcaster?.userId ?? '';
    if (protectedUser(user, id)) {
      this.log('twitch', 'Protected account: contempt timeout skipped.');
      return;
    }
    await this.action(`timeout ${user.id} ${seconds}s`, async () => {
      try {
        const [mods, vip] = await Promise.all([
          this.api.moderation.getModerators(this.broadcaster(), { userId: user.id }),
          this.api.channels.checkVipForUser(this.broadcaster(), user.id),
        ]);
        if (mods.data.length || vip) {
          this.log('twitch', 'Protected account: contempt timeout skipped.');
          return;
        }
      } catch {
        this.log('twitch', 'Cannot verify protected status; contempt timeout skipped.');
        return;
      }
      if (!active()) return;
      await this.api.asUser(this.broadcaster(), (ctx) =>
        ctx.moderation.banUser(this.broadcaster(), {
          user: user.id,
          duration: Math.max(1, Math.min(60, seconds)),
          reason,
        }),
      );
    });
  }
  async getStream(): Promise<StreamInfo> {
    const id = this.broadcaster();
    const [stream, channel] = await Promise.all([
      this.api.asUser(id, (ctx) => ctx.streams.getStreamByUserId(id)),
      this.api.asUser(id, (ctx) => ctx.channels.getChannelInfoById(id)),
    ]);
    const info: StreamInfo = {
      live: !!stream,
      broadcastId: stream?.id,
      channelId: id,
      title: channel?.title ?? 'Live stream',
      displayName: channel?.displayName,
      startedAt: stream?.startDate.getTime() ?? null,
    };
    this.evidence.stream = info.live ? 'live' : 'offline';
    this.onStreamInfo?.(info);
    return info;
  }
  async createClip(active = () => true) {
    try {
      if (!(await this.getStream()).live) {
        this.log('twitch', 'Clip skipped: channel is offline.');
        return;
      }
      if (!active()) return;
      await this.action('createClip', () =>
        this.api.asUser(this.broadcaster(), (ctx) =>
          ctx.clips.createClip({ channel: this.broadcaster() }),
        ),
      );
    } catch {
      this.log('twitch', 'Clip unavailable. Check live status and clips:edit.');
    }
  }
  async createMarker(description: string, active = () => true) {
    try {
      if (!(await this.getStream()).live) {
        this.log('twitch', 'Marker skipped: channel is offline.');
        return;
      }
      if (!active()) return;
      await this.action(`createMarker: ${description}`, () =>
        this.api.asUser(this.broadcaster(), (ctx) =>
          ctx.streams.createStreamMarker(this.broadcaster(), description.slice(0, 140)),
        ),
      );
    } catch {
      this.log('twitch', 'Marker unavailable. Check live status and channel:manage:broadcast.');
    }
  }
  async createPoll() {
    try {
      await this.action('createPoll', () =>
        this.api.polls.createPoll(this.broadcaster(), {
          title: 'Court of Chat: your verdict?',
          choices: ['GUILTY — vote !g', 'NOT GUILTY — vote !ng'],
          duration: Math.max(15, Math.min(1800, Math.round(this.settings().phaseMs.JURY / 1000))),
        }),
      );
    } catch {
      this.log('twitch', 'Native poll unavailable; use !g and !ng in chat.');
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.listener?.stop();
  }
}
