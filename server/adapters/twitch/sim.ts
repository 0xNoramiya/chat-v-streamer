import type { TwitchAdapter, StreamInfo, TwitchExecution } from './types.js';
import type { User } from '../../../web/src/shared/types.js';
export const simUser = (id: string): User => ({
  id,
  login: id,
  broadcaster: id === 'broadcaster',
  mod: id === 'mod1',
  vip: id === 'vip1',
});
export class SimTwitch implements TwitchAdapter {
  execution(): TwitchExecution {
    return { mode: 'simulated', channelId: 'local-simulator' };
  }
  status = 'simulator';
  eventsubStatus = 'simulator';
  title = 'A completely ordinary boss run';
  constructor(private log: (kind: string, text: string) => void) {}
  async sendChat(text: string) {
    this.log('chat', text.slice(0, 500));
  }
  async setTitle(text: string) {
    this.title = text.slice(0, 140);
    this.log('twitch', `SIM setTitle: ${this.title}`);
  }
  async timeout(u: User, seconds: number, reason: string) {
    if (u.broadcaster || u.mod || u.vip) return;
    this.log('twitch', `SIM timeout ${u.id} ${seconds}s: ${reason}`);
  }
  async createClip() {
    this.log('twitch', 'SIM createClip');
  }
  async createMarker(description: string) {
    this.log('twitch', `SIM createMarker: ${description}`);
  }
  async getStream(): Promise<StreamInfo> {
    return { live: true, title: this.title, startedAt: null };
  }
  async createPoll() {
    this.log('twitch', 'SIM jury poll: GUILTY / NOT GUILTY');
  }
}
