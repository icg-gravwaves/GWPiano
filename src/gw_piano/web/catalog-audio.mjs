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
