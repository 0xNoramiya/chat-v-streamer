export interface ObsAdapter {
  status: string;
  enterCourt(scene: string): Promise<void>;
  restore(): Promise<void>;
  capture?(source: string): Promise<string | null>;
  close?(): void;
}
