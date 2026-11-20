import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {landmarks, landmarkNotes, chirpMass, equivalentMass} from '../src/gw_piano/web/landmarks.mjs';

const catalog = JSON.parse(readFileSync(new URL('../src/gw_piano/data/catalog.json', import.meta.url)));
const notes = [{midi:108,name:'C8',mass:1.9,frequency:4186},{midi:69,name:'A4',mass:18,frequency:440},{midi:33,name:'A1',mass:144,frequency:55}];
test('equal masses are their own chirp-mass equivalent', () => {
  assert.ok(Math.abs(equivalentMass([18, 18]) - 18) < 1e-12);
  assert.ok(Math.abs(chirpMass([18, 18]) - 18 / 2 ** 0.2) < 1e-12);
});
test('each landmark plays its chirp-mass-equivalent binary', () => {
  const result = landmarkNotes(catalog.events, notes);
  assert.equal(result.length, landmarks.length);
  for (const landmark of result) {
    assert.ok(Math.abs(chirpMass([landmark.mass, landmark.mass]) - chirpMass(landmark.event.masses)) < 1e-9);
    assert.ok(Math.abs(landmark.part.frequency * landmark.mass - landmark.note.frequency * landmark.note.mass) < 1e-6);
  }
  assert.equal(result.find(landmark => landmark.name === 'GW170817').note.name, 'C8');
});
