/** Chirp mass (m1 m2)^(3/5) / (m1 + m2)^(1/5): the mass combination that sets how the inspiral sweeps up in frequency. */
export function chirpMass([m1, m2]) {
  return (m1 * m2) ** 0.6 / (m1 + m2) ** 0.2;
}

/** Component mass of the equal-mass binary with the same chirp mass (m = 2^(1/5) Mc); a lone component stands for itself. */
export function equivalentMass(masses) {
  if (!masses.every(mass => Number.isFinite(mass) && mass > 0)) throw new RangeError('Catalog masses must be positive');
  return masses.length === 2 ? 2 ** 0.2 * chirpMass(masses) : masses[0];
}

/** Nearest note to a value on a log scale (pitch for frequencies, inverse pitch for masses). */
function nearest(notes, key, value) {
  return notes.reduce((best, candidate) =>
    Math.abs(Math.log(candidate[key] / value)) < Math.abs(Math.log(best[key] / value)) ? candidate : best);
}

/**
 * One sound per merger, resampled from the nearest note's sample.
 * With a build-time `peak` (the binary's own IMRPhenomD merger frequency) the sound is tuned to that
 * frequency, so unequal pairs need no equal-mass assumption. Without one, the event falls back to the
 * chirp-mass-equivalent equal-mass binary. `mass` is the equal-mass pair that sounds at the same pitch.
 */
export function catalogPlan(events, notes, spacing = 0) {
  if (!notes.length) throw new RangeError('Reference piano samples are required');
  const ordered = [...events].sort((a,b) => (a.offset ?? 0)-(b.offset ?? 0) || a.name.localeCompare(b.name));
  return ordered.map((event, index) => {
    let note, playbackRate, mass;
    if (Number.isFinite(event.peak) && event.peak > 0) {
      note = nearest(notes, 'frequency', event.peak);
      playbackRate = event.peak / note.frequency;
      mass = note.mass / playbackRate;
    } else {
      mass = equivalentMass(event.masses);
      note = nearest(notes, 'mass', mass);
      playbackRate = note.mass / mass;
    }
    return {event: event.name, offset: event.offset ?? index * spacing, mass, components: event.masses,
      note, playbackRate, frequency: note.frequency * playbackRate};
  });
}

/** Highlight only components whose audio interval contains the playback time. */
export function activeNotes(plan, elapsed) {
  return new Set(plan.filter(part => elapsed >= part.offset &&
    elapsed < part.offset + part.duration).map(part => part.note.midi));
}

/** Schedule cached note buffers directly, scaling pitch and duration by mass. */
export function scheduleCatalog(context, plan, bufferFor, output, start, onended) {
  const gain = context.createGain(), sources = new Set();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.25, start + 0.005);
  gain.connect(output);
  let stopped = false;
  const batch = {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const source of sources) source.stop();
      gain.disconnect();
    }
  };
  try {
    for (const part of plan) {
      const source = context.createBufferSource();
      source.buffer = bufferFor(part.note);
      source.playbackRate.value = part.playbackRate;
      part.duration = source.buffer.duration / part.playbackRate;
      source.connect(gain);
      sources.add(source);
      source.onended = () => {
        sources.delete(source);
        source.disconnect();
        if (!sources.size && !stopped) { gain.disconnect(); onended(); }
      };
      source.start(start + part.offset);
    }
  } catch (error) { batch.stop(); throw error; }
  return batch;
}
