import { afterEach, expect, it, vi } from 'vitest';
import { CourtAudio } from '../web/src/overlay/audio.js';
import type { CaptionEvent, SpeechEvent } from '../web/src/shared/types.js';
class AudioFixture {
  static instances: AudioFixture[] = [];
  duration = 3;
  src: string;
  preload = '';
  plays = 0;
  paused = 0;
  onloadedmetadata?(): Promise<void>;
  constructor(url: string) {
    this.src = url;
    AudioFixture.instances.push(this);
  }
  async play() {
    this.plays++;
  }
  pause() {
    this.paused++;
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  AudioFixture.instances = [];
});
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal('Audio', AudioFixture);
  const shown: (CaptionEvent | null)[] = [],
    player = new CourtAudio((c) => shown.push(c));
  player.sync('1:EXHIBITS:0:0', 0);
  const caption: CaptionEvent = {
    type: 'caption',
    id: 'a',
    scope: '1:EXHIBITS:0:0',
    speaker: 'D.A. Receipts',
    text: 'Exhibit A. The stored receipt.',
    sentAt: 0,
    expiresAt: 8000,
  };
  const speech: SpeechEvent = {
    type: 'speech',
    captionId: 'a',
    scope: caption.scope,
    url: '/tts/fixture.mp3',
    sentAt: 0,
    expiresAt: 8000,
  };
  player.enqueue(caption);
  return { player, shown, caption, speech };
}
it('displays the complete caption immediately and refuses audio too long for the remaining deadline', async () => {
  const f = fixture();
  expect(f.shown.at(-1)?.text).toBe(f.caption.text);
  await vi.advanceTimersByTimeAsync(6000);
  f.player.attach(f.speech);
  const audio = AudioFixture.instances[0];
  await audio.onloadedmetadata?.();
  expect(audio.plays).toBe(0);
  expect(f.shown.at(-1)?.id).toBe('a');
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.shown.at(-1)).toBeNull();
  f.player.close();
});
it('invalidates previous-exhibit audio within the same phase', () => {
  const f = fixture();
  f.player.sync('1:EXHIBITS:1000:1', 1000);
  f.player.attach(f.speech);
  expect(AudioFixture.instances).toHaveLength(0);
  f.player.close();
});
it('does not start an expired clip or an obsolete line within the same exhibit', () => {
  const f = fixture();
  f.player.enqueue({ ...f.caption, id: 'b' });
  f.player.attach(f.speech);
  expect(AudioFixture.instances).toHaveLength(0);
  f.player.clear();
  f.player.sync(f.caption.scope, 9000);
  f.player.enqueue(f.caption);
  f.player.attach(f.speech);
  expect(AudioFixture.instances).toHaveLength(0);
  f.player.close();
});
it('plays an in-budget matching clip and stops it on the next scope', async () => {
  const f = fixture();
  f.player.attach(f.speech);
  await AudioFixture.instances[0].onloadedmetadata?.();
  expect(AudioFixture.instances[0].plays).toBe(1);
  f.player.sync('1:DEFENSE:8000:2', 8000);
  expect(AudioFixture.instances[0].paused).toBe(1);
  f.player.close();
});
