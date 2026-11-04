import {musicalSample} from './musical.mjs';

/** Preserve each selected catalog component and derive its exact mass-scaled pitch. */
export function catalogPlan(events, notes, spacing = 0) {
  if (!notes.length) throw new RangeError('Reference piano samples are required');
  const ordered = [...events].sort((a,b) => (a.offset ?? 0)-(b.offset ?? 0) || a.name.localeCompare(b.name));
  return ordered.flatMap((event, index) => event.masses.map(mass => {
    if (!Number.isFinite(mass) || mass <= 0) throw new RangeError('Catalog masses must be positive');
    const note = notes.reduce((best, candidate) =>
      Math.abs(Math.log(candidate.mass / mass)) < Math.abs(Math.log(best.mass / mass)) ? candidate : best);
    const playbackRate = note.mass / mass;
    return {event: event.name, offset: event.offset ?? index * spacing, mass, note, playbackRate, frequency: note.frequency * playbackRate};
  }));
}

/** Sum every component into one buffer, avoiding browser voice-count limits. */
export async function mixCatalog(plan, sourceFor, sampleRate, musical = false, yieldControl = async () => {}) {
  if (!plan.length) throw new RangeError('Catalog components are required');
  const lengths = plan.map(part => {
    const source = sourceFor(part.note);
    const length = Math.ceil(source.samples.length * sampleRate / source.sampleRate / part.playbackRate);
    return Math.round((part.offset || 0) * sampleRate) + (musical ? Math.max(length, Math.ceil(0.5 * sampleRate)) : length);
  });
  const output = new Float32Array(Math.max(...lengths));
  let usedLength = 0;
  for (let component = 0; component < plan.length; component++) {
    const part = plan[component], source = sourceFor(part.note);
    const step = source.sampleRate / sampleRate * part.playbackRate;
    let samples = new Float32Array(Math.ceil(source.samples.length / step));
    for (let i = 0; i < samples.length; i++) {
      const position = i * step, left = Math.floor(position), fraction = position - left;
      samples[i] = (source.samples[left] || 0) * (1 - fraction) + (source.samples[left + 1] || 0) * fraction;
    }
    if (musical) samples = musicalSample(samples, sampleRate, part.frequency);
    part.duration = samples.length / sampleRate;
    const offset = Math.round((part.offset || 0) * sampleRate);
    usedLength = Math.max(usedLength, offset + samples.length);
    for (let i = 0; i < samples.length; i++) output[offset + i] += samples[i];
    if (component % 16 === 15) await yieldControl();
  }
  const result = output.subarray(0, usedLength);
  let peak = 0;
  for (const value of result) peak = Math.max(peak, Math.abs(value));
  if (peak) for (let i = 0; i < result.length; i++) result[i] *= 0.9 / peak;
  return result;
}

/** Highlight only components whose audio interval contains the playback time. */
export function activeNotes(plan, elapsed) {
  return new Set(plan.filter(part => elapsed >= part.offset &&
    elapsed < part.offset + part.duration).map(part => part.note.midi));
}
