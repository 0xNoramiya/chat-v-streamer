import { expect, it } from 'vitest';
import { CaptureReadiness } from '../server/adapters/transcript/readiness.js';
it('does not claim capture without a key, recording client, successful transcription and fresh heartbeat', () => {
  let now = 0;
  const unavailable = new CaptureReadiness(false, () => now);
  unavailable.update('p', 'recording');
  expect(unavailable.status().state).toBe('unavailable');
  const capture = new CaptureReadiness(true, () => now);
  expect(capture.status().state).toBe('off');
  capture.update('p', 'recording');
  expect(capture.status().state).toBe('pending');
  capture.result('p', true);
  expect(capture.status().state).toBe('recording');
  now = 10001;
  expect(capture.status().state).toBe('off');
  expect(capture.status(true).state).toBe('simulated');
  expect(capture.status(false, true).state).toBe('manual');
});
it('an error remains visible until a successful upload and a late upload cannot revive a stopped mic', () => {
  const capture = new CaptureReadiness(true, () => 0);
  capture.update('p', 'recording');
  capture.result('p', false);
  capture.update('p', 'recording');
  expect(capture.status().state).toBe('error');
  capture.result('p', true);
  expect(capture.status().state).toBe('error');
  capture.update('p', 'recording');
  expect(capture.status().state).toBe('recording');
  capture.update('p', 'stopped');
  capture.result('p', true);
  expect(capture.status().state).toBe('off');
});

it('ignores reordered heartbeat requests and does not let a late upload revive capture after the panel closes', () => {
  let now = 0;
  const capture = new CaptureReadiness(true, () => now);
  capture.update('p', 'recording', 1);
  capture.result('p', true);
  capture.update('p', 'stopped', 3);
  capture.update('p', 'recording', 2);
  expect(capture.status().state).toBe('off');
  capture.update('p', 'recording', 4);
  now = 11000;
  capture.result('p', true);
  expect(capture.status().state).toBe('off');
});

it('a late successful upload cannot claim that a failed microphone is recording again', () => {
  const capture = new CaptureReadiness(true, () => 0);
  capture.update('p', 'recording');
  capture.update('p', 'error');
  capture.result('p', true);
  expect(capture.status().state).toBe('error');
});
