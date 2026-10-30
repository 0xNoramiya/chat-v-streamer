export type CaptureState = 'starting' | 'recording' | 'stopped' | 'error';
export interface CaptureStatus {
  state: 'unavailable' | 'off' | 'pending' | 'recording' | 'error' | 'simulated' | 'manual';
  detail: string;
}
export class CaptureReadiness {
  private clients = new Map<
    string,
    { state: CaptureState; at: number; success: boolean; sequence: number }
  >();
  constructor(
    private configured: boolean,
    private now: () => number,
  ) {}
  update(id: string, state: CaptureState, sequence = (this.clients.get(id)?.sequence ?? -1) + 1) {
    const previous = this.clients.get(id);
    if (previous && sequence <= previous.sequence) return;
    this.clients.set(id, {
      state:
        state === 'recording' && previous?.state === 'error' && !previous.success ? 'error' : state,
      at: this.now(),
      success: previous?.success ?? false,
      sequence,
    });
  }
  result(id: string, success: boolean) {
    const c = this.clients.get(id);
    if (c)
      this.clients.set(id, {
        ...c,
        success,
        state: c.state === 'stopped' ? 'stopped' : success ? c.state : 'error',
      });
  }
  status(simulated = false, manual = false): CaptureStatus {
    if (simulated) return { state: 'simulated', detail: 'Simulated defense · no microphone' };
    const clients = [...this.clients.values()].filter((c) => this.now() - c.at <= 10000);
    const recording = clients.find((c) => c.state === 'recording');
    if (this.configured && recording)
      return {
        state: recording.success ? 'recording' : 'pending',
        detail: recording.success
          ? 'Mic recording · transcription active'
          : 'Mic recording · transcription not yet verified',
      };
    if (manual) return { state: 'manual', detail: 'Manual defense recorded · mic capture off' };
    if (!this.configured)
      return { state: 'unavailable', detail: 'Mic transcription unavailable · manual entry works' };
    if (clients.some((c) => c.state === 'error'))
      return { state: 'error', detail: 'Mic/transcription failed · manual entry works' };
    return { state: 'off', detail: 'Mic capture off · defense is not being transcribed' };
  }
}
