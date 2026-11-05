import test from 'node:test';
import assert from 'node:assert/strict';
import {tunes, tuneSchedule} from '../src/gw_piano/web/tunes.mjs';

test('example tunes are time ordered', () => {
  for (const tune of tunes.filter(t => t.notes.length)) {
    const times = tune.notes.map(([, time]) => time);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
});

test('tunes resolve against the keyboard range or report missing notes', () => {
  const keyboard = Array.from({length: 37}, (_, i) => ({midi: 48 + i}));
  const schedule = tuneSchedule(tunes[0], keyboard);
  assert.equal(schedule.length, tunes[0].notes.length);
  assert.ok(schedule.filter(step => step.time === schedule[0].time).some(step => step.note.midi === 67));
  assert.equal(tuneSchedule(tunes[0], keyboard.slice(20)), null);
});
