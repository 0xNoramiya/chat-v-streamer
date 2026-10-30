import type { User } from '../../../web/src/shared/types.js';
export interface TwitchExecution {
  mode: 'live' | 'dry_run' | 'simulated';
  channelId: string | null;
}
export interface StreamInfo {
  live: boolean;
  broadcastId?: string;
  channelId?: string;
  title: string;
  startedAt: number | null;
  displayName?: string;
}
export interface TwitchAdapter {
  execution(): TwitchExecution;
  status: string;
  eventsubStatus: string;
  botId?: string;
  connect?(): Promise<void>;
  close?(): void;
  onStreamInfo?: (info: StreamInfo) => void;
  onMessage?: (u: User, text: string) => void;
  onRedemption?: (u: User, text: string) => void;
  sendChat(text: string): Promise<void>;
  setTitle(text: string): Promise<void>;
  timeout(user: User, seconds: number, reason: string, active?: () => boolean): Promise<void>;
  createClip(active?: () => boolean): Promise<void>;
  createMarker(description: string, active?: () => boolean): Promise<void>;
  getStream(): Promise<StreamInfo>;
  createPoll?(): Promise<void>;
}
