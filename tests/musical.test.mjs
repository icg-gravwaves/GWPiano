import test from 'node:test';
import assert from 'node:assert/strict';
import {musicalSample} from '../src/gw_piano/web/musical.mjs';

const rate = 44100;
function modelFixture() {
  const samples = new Float32Array(rate);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.2 * Math.sin(i / 12);
  samples[Math.round(0.75 * rate)] = 0.9;
  return samples;
}
function tailFrequency(samples) {
  const crossings = [];
  for (let i = samples.length - Math.round(0.2 * rate); i < samples.length - 1; i++) {
    if (samples[i] <= 0 && samples[i + 1] > 0) crossings.push(i);
  }
  return rate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
}
test('musical tail resolves each requested note frequency', () => {
  for (const frequency of [130.8128, 440, 880, 1046.5023]) {
    const samples = musicalSample(modelFixture(), rate, frequency);
    assert.ok(Math.abs(tailFrequency(samples) - frequency) < 1);
  }
});
test('musical samples have a short chirp, a 350 ms tone, and smooth silent endpoints', () => {
  const samples = musicalSample(modelFixture(), rate, 440);
  assert.ok(Math.abs(samples.length / rate - 0.47) < 1 / rate);
  assert.equal(Math.abs(samples[0]), 0);
  assert.equal(Math.abs(samples.at(-1)), 0);
  assert.ok(samples.every(Number.isFinite));
  assert.ok(Math.abs(samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) - 0.9) < 1e-6);
});
test('musical processing preserves the scientific input', () => {
  const input = modelFixture(), original = input.slice();
  musicalSample(input, rate, 440);
  assert.deepEqual(input, original);
});
test('invalid frequencies are rejected', () => {
  for (const frequency of [0, -1, NaN, rate / 2]) {
    assert.throws(() => musicalSample(modelFixture(), rate, frequency), RangeError);
  }
});
