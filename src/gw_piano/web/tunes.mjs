/** Public-domain example tunes. Each note is [MIDI number, start time in seconds]. */
// Quaver length in seconds, matching the opening motif's tempo.
const Q = 0.18;
const B = 0.75;

/** Play every MIDI note in a chord at the same time. */
const chord = (midis, time) => midis.map(midi => [midi, Math.round(time * 100) / 100]);

/**
 * Quaver rest, three repeated quavers, then a held note, all over one harmony.
 * Each item is [repeated melody note, held melody note, accompaniment]; one cell every 6 quavers.
 */
function cells(start, motifs) {
  return motifs.flatMap(([repeat, last, under], i) => {
    const t = start + i * 6 * Q;
    return [1, 2, 3].flatMap(k => chord([...under, repeat], t + k * Q))
      .concat(chord([...under, last], t + 4 * Q));
  });
}

/** Drunken Sailor: [MIDI, length in beats] melody with a two-note bass on beats 1 and 3. */
function drunkenSailor(beat = 0.22) {
  const A = 69, B = 71, C5 = 72, D5 = 74, D = 62, E = 64, F = 65, G = 67, C = 60;
  const run = n => [[n, 1], [n, 0.5], [n, 0.5], [n, 1], [n, 0.5], [n, 0.5]];
  const bars = [
    run(A), [[A, 1], [D, 1], [F, 1], [A, 1]],        // What shall we do with the drunken sailor
    run(G), [[G, 1], [C, 1], [E, 1], [G, 1]],        // (repeat)
    run(A), [[A, 1], [B, 1], [C5, 1], [D5, 1]],      // (repeat)
    [[C5, 1], [A, 1], [G, 1], [E, 1]], [[D, 2], [D, 2]]  // Early in the morning
  ];
  const Dm = [50, 57], Cmaj = [48, 55];
  const bass = [Dm, Dm, Cmaj, Cmaj, Dm, Dm, Cmaj, Dm];
  const out = [];
  bars.forEach((bar, b) => {
    const start = b * 4;
    out.push(...chord(bass[b], start * beat), ...chord(bass[b], (start + 2) * beat));
    let t = start;
    for (const [midi, len] of bar) { out.push([midi, Math.round(t * beat * 100) / 100]); t += len; }
  });
  return out.sort((x, y) => x[1] - y[1]);
}

/** Notes placed in 4/4 bars: [MIDI, bar, beat in bar] with beats in crotchets; time ordered. */
function bars(crotchet, list) {
  return list.map(([midi, bar, beat]) => [midi, Math.round((bar * 4 + beat) * crotchet * 100) / 100])
    .sort((x, y) => x[1] - y[1]);
}

/** One bar of the Just Can't Get Enough riff: G | G G-G | (rest) G G | A B. */
const riff = bar => [
  [67, bar, 0], [67, bar, 1], [67, bar, 1.5], [67, bar, 1.75],
  [67, bar, 2.25], [67, bar, 2.5], [69, bar, 3], [71, bar, 3.5]
];

// MIDI: C3=48, G3=55, C4=60, G4=67, C5=72. The keyboard covers C3–C6.
export const tunes = [
  {
    id: 'beethoven-5',
    label: 'Example 1',
    title: "Beethoven's 5th",
    // Symphony No. 5 in C minor (1808), a simplified keyboard reduction.
    // Bars 1–5: the motif in octaves, G G G E♭ … F F F D.
    // Bars 6–13: G G G E♭ | A♭ A♭ A♭ G | E♭ E♭ E♭ C, then G G G D | A♭ A♭ A♭ G | F F F D.
    notes: [
      ...[0.18, 0.36, 0.54].flatMap(t => chord([55, 67], t)), ...chord([51, 63], 0.72),
      ...[2.18, 2.36, 2.54].flatMap(t => chord([53, 65], t)), ...chord([50, 62], 2.72),
      ...cells(3.6, [[67, 63, [48, 55]], [68, 67, [53, 60]], [75, 72, [56, 63]]]),
      ...cells(7.2, [[67, 62, [55, 59]], [68, 67, [53, 60]], [77, 74, [55, 59]]])
    ]
  },
  {
    id: 'example-2',
    label: 'Example 2',
    title: 'Example 2',
    // Add notes here as [MIDI number, start time in seconds], in time order.
    // Bass tab to MIDI: open E=28, A=33, D=38, G=43, then add the fret number.
    // The keyboard spans C3–C6 (48–84), so add 24 (two octaves) to bass notes.
    // Use chord([midi, midi + 12], time) to double a note in octaves.
    notes: [
      [57, 0 * B],
      [57, 1.5 * B],
      [59, 1.75 * B],
      [60, 2 * B],
      [59, 2.25 * B],
      [57, 2.5 * B],
      [55, 2.75 * B],
      [57, 3 * B],
      [59, 3.25 * B],
      [52, 3.75 * B], 
    ]
  },
  {
    id: 'drunken-sailor',
    label: 'Example 3',
    title: 'Drunken Sailor',
    // Traditional sea shanty, first verse, in D Dorian; melody over a D minor / C bass.
    notes: drunkenSailor()
  },
  {
    id: 'just-cant-get-enough',
    label: 'Example 4',
    title: "Just Can't Get Enough",
    // Piano arrangement in G major, 4/4, four bars: the riff three times, then a
    // C B A B turnaround. 0.6 s per crotchet (100 bpm).
    notes: bars(0.6, [
      ...riff(0), ...riff(1), ...riff(2),
      [72, 3, 0], [71, 3, 1], [69, 3, 2], [71, 3, 3]                 // C B A B
    ])
  }
];

/** Resolve tune MIDI numbers to keyboard notes; null if any note is off the keyboard. */
export function tuneSchedule(tune, notes) {
  const byMidi = new Map(notes.map(note => [note.midi, note]));
  const schedule = tune.notes.map(([midi, time]) => ({note: byMidi.get(midi), time}));
  return schedule.every(step => step.note) ? schedule : null;
}
