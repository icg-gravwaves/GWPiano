// GW Piano stand kiosk: audio engine and live display.
// kiosk-live.html runs this module. It plays the sound-pack samples for MIDI
// notes from the keyboard, follows the CC20 mode switch, takes commands from
// kiosk-controls.html over a BroadcastChannel, and draws a scrolling strain
// timeseries, a scrolling spectrogram and the catalogue mass histogram.
import {massBins} from './histogram.mjs';
import {catalogPlan, scheduleCatalog} from './catalog-audio.mjs';
import {eventTimeline} from './timeline.mjs';
import {tunes, tuneSchedule} from './tunes.mjs';
import {landmarks, landmarkNotes} from './landmarks.mjs';

// Seconds between detections in Play detections in order. Each sample lasts up to 0.35 s,
// so neighbouring chirps overlap a little while staying distinct on the timeseries.
const DETECTION_SPACING = 0.2;
const MODE_CC = 20;            // CC20 0-63 scientific, 64-127 musical, as in GW-Piano.sfz
const WINDOW_SECONDS = 4.5;    // span of the scrolling timeseries and spectrogram
const MAX_LEVEL = 0.3;         // master gain cap; with the ALSA mixer, sets the stand's maximum volume
const MAX_VOICES = 24;
const BLOCK = 256;           // samples per timeseries envelope point (about 6 ms)
const F_LOW = 20, F_HIGH = 2000;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const channel = new BroadcastChannel('gw-piano-kiosk');
const state = {mode: 'scientific', busy: null, ready: false, played: [], lastNote: null};
let context, master, analyser, notes = [], byMidi = new Map(), catalog;
const buffers = {scientific: new Map(), musical: new Map()};
const voices = new Set();
let tuneTimers = [], batch = null, generation = 0;
const markers = [];   // {time, label, colour}: note onsets drawn on the strips

function broadcast() {
  channel.postMessage({type: 'state', mode: state.mode, busy: state.busy, ready: state.ready});
  document.querySelector('#mode-chip').textContent = state.mode;
  document.querySelector('#mode-chip').dataset.mode = state.mode;
}

async function loadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return context.decodeAudioData(await response.arrayBuffer());
}

async function start() {
  context = new AudioContext({latencyHint: 'interactive'});
  master = context.createGain();
  master.gain.value = MAX_LEVEL;
  const compressor = context.createDynamicsCompressor();
  analyser = context.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  master.connect(compressor).connect(analyser).connect(context.destination);
  // An AudioWorklet records the exact min/max envelope of the output, block by block, so
  // the timeseries is correct however irregularly the display redraws.
  const worklet = `registerProcessor('gw-envelope', class extends AudioWorkletProcessor {
    constructor() { super(); this.lo = 0; this.hi = 0; this.n = 0; }
    process([input]) {
      const data = input[0] || new Float32Array(128);
      for (const v of data) { if (v < this.lo) this.lo = v; if (v > this.hi) this.hi = v; }
      this.n += data.length;
      if (this.n >= ${BLOCK}) { this.port.postMessage([currentFrame, this.lo, this.hi]); this.lo = this.hi = 0; this.n = 0; }
      return true;
    }
  });`;
  await context.audioWorklet.addModule(URL.createObjectURL(new Blob([worklet], {type: 'text/javascript'})));
  const envelope = new AudioWorkletNode(context, 'gw-envelope');
  envelope.port.onmessage = ({data: [frameIndex, lo, hi]}) => {
    const block = Math.floor(frameIndex / BLOCK), slot = block % ENVELOPE_SLOTS;
    envelopeBlock[slot] = block; envelopeLo[slot] = lo; envelopeHi[slot] = hi;
  };
  analyser.connect(envelope);
  const [pack, catalogData] = await Promise.all([
    fetch('sound-pack-manifest.json').then(r => r.json()), fetch('catalog.json').then(r => r.json())]);
  notes = pack.notes; catalog = catalogData;
  byMidi = new Map(notes.map(note => [note.midi, note]));
  const status = document.querySelector('#status');
  // Decode four files at a time to bound memory use on the Pi.
  const queue = notes.flatMap(note => [['scientific', note, note.file], ['musical', note, note.musical_file]]);
  let loaded = 0;
  await Promise.all(Array.from({length: 4}, async () => {
    while (queue.length) {
      const [mode, note, url] = queue.shift();
      try { buffers[mode].set(note.midi, await loadBuffer(url)); }
      catch (error) { console.debug('GW Piano kiosk sample unavailable', url, error); }
      status.textContent = `Loading sounds ${++loaded}/${notes.length * 2}`;
    }
  }));
  state.ready = true;
  status.textContent = '';
  broadcast();
  drawHistogram();
  requestAnimationFrame(frame);
}

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  console.debug('GW Piano kiosk mode', mode);
  broadcast();
}

function voice(buffer, when, rate = 1, level = 0.25) {
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer; source.playbackRate.value = rate;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(level, when + 0.005);
  source.connect(gain).connect(master);
  voices.add(source);
  source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); };
  source.start(when);
  return source;
}

function addPlayed(mass, label, when, note = null) {
  const colour = state.mode === 'musical' ? css('--warning') : css('--signal');
  markers.push({time: when, label, colour});
  // The sounding note's key marker is highlighted on the histogram when it plays.
  // Timers join tuneTimers so Stop all also stops pending histogram updates.
  tuneTimers.push(setTimeout(() => { state.played.push(mass); if (note) state.lastNote = note; drawHistogram(); },
             Math.max(0, (when - context.currentTime) * 1000)));
}

function playNote(midi, velocity = 100, when = null) {
  const note = byMidi.get(midi);
  const buffer = note && buffers[state.mode].get(midi);
  if (!buffer) return;
  if (context.state !== 'running') context.resume();
  const manual = [...voices];
  if (manual.length >= MAX_VOICES) { manual[0].stop(); voices.delete(manual[0]); }
  const at = when ?? context.currentTime;
  voice(buffer, at, 1, 0.25 * (0.3 + 0.7 * velocity / 127));
  state.lastNote = note;
  addPlayed(note.mass, `${note.name} · ${note.mass.toFixed(0)} M☉`, at);
  addPlayed(note.mass, null, at);   // equal-mass binary: two components
  document.querySelector('#last-note').textContent =
    `Last note: ${note.name} · 2 × ${note.mass.toFixed(1)} M☉ · ${state.mode}`;
}

function stopAll() {
  generation++;
  for (const timer of tuneTimers) clearTimeout(timer);
  tuneTimers = [];
  batch?.stop(); batch = null;
  for (const source of voices) source.stop();
  voices.clear();
  state.busy = null;
  broadcast();
}

function playTune(index) {
  stopAll();
  const schedule = tuneSchedule(tunes[index], notes);
  if (!schedule) return;
  const ticket = generation;
  state.busy = `tune-${index}`; broadcast();
  for (const {note, time} of schedule) {
    tuneTimers.push(setTimeout(() => { if (ticket === generation) playNote(note.midi); }, time * 1000));
  }
  const end = Math.max(...schedule.map(step => step.time)) + 1.5;
  tuneTimers.push(setTimeout(() => { if (ticket === generation) { state.busy = null; broadcast(); } }, end * 1000));
}

function playDetections(condensed) {
  stopAll();
  const ticket = generation;
  const plan = catalogPlan(eventTimeline(catalog.events, condensed, 30, DETECTION_SPACING), notes, DETECTION_SPACING);
  const at = context.currentTime + 0.05;
  state.played = []; drawHistogram();
  state.busy = condensed ? 'timeline' : 'detections'; broadcast();
  batch = scheduleCatalog(context, plan, note => buffers[state.mode].get(note.midi), master, at, () => {
    if (ticket === generation) { batch = null; state.busy = null; broadcast(); }
  });
  let lastEvent = null;
  for (const part of plan) {
    const label = part.event !== lastEvent ? part.event : null;
    lastEvent = part.event;
    addPlayed(part.mass, label, at + part.offset, part.note);
  }
}

/** Play one notable detection as its chirp-mass-equivalent equal-mass chirp. */
function playLandmark(index) {
  stopAll();
  const landmark = landmarkNotes(catalog.events, notes).find(item => item.name === landmarks[index]?.name);
  if (!landmark) { console.debug('GW Piano landmark not in catalogue', index); return; }
  const ticket = generation;
  const at = context.currentTime + 0.05;
  state.busy = `landmark-${index}`; broadcast();
  batch = scheduleCatalog(context, [{...landmark.part}], note => buffers[state.mode].get(note.midi), master, at, () => {
    if (ticket === generation) { batch = null; state.busy = null; broadcast(); }
  });
  // Each component of the real binary goes on the histogram; the first carries the event label.
  landmark.event.masses.forEach((mass, i) => addPlayed(mass, i === 0 ? landmark.name : null, at, landmark.note));
  document.querySelector('#last-note').textContent =
    `${landmark.name} · ${landmark.title} · ${landmark.event.masses.join(' + ')} M☉`;
  console.debug('GW Piano kiosk landmark', landmark.name, landmark.part.frequency);
}

channel.onmessage = ({data}) => {
  console.debug('GW Piano kiosk command', data);
  if (!state.ready && data.type !== 'hello') return;
  if (data.type === 'hello') broadcast();
  else if (data.type === 'mode') { setMode(data.mode); midiOut(data.mode); }
  else if (data.type === 'tune') playTune(data.index);
  else if (data.type === 'detections') playDetections(data.condensed);
  else if (data.type === 'landmark') playLandmark(data.index);
  else if (data.type === 'stop') stopAll();
  else if (data.type === 'reset') { stopAll(); state.played = []; markers.length = 0; drawHistogram(); }
};

// ---- MIDI: notes from the keyboard, CC20 from the mode pad ----
let midiOutputs = [];
function midiOut(mode) {
  // Keep the pad's toggle state and any external sampler in step with the touch screen.
  for (const output of midiOutputs) output.send([0xB0, MODE_CC, mode === 'musical' ? 127 : 0]);
}
async function connectMidi() {
  if (!navigator.requestMIDIAccess) { console.debug('GW Piano kiosk: Web MIDI unavailable'); return; }
  try {
    const access = await navigator.requestMIDIAccess();
    const bind = () => {
      midiOutputs = [...access.outputs.values()];
      for (const input of access.inputs.values()) input.onmidimessage = ({data: [status, a, b]}) => {
        const kind = status & 0xF0;
        if (kind === 0x90 && b > 0) playNote(a, b);
        else if (kind === 0xB0 && a === MODE_CC) setMode(b >= 64 ? 'musical' : 'scientific');
      };
      console.debug('GW Piano kiosk MIDI inputs', [...access.inputs.values()].map(i => i.name));
    };
    bind(); access.onstatechange = bind;
  } catch (error) { console.debug('GW Piano kiosk MIDI access refused', error); }
}

// Computer keys for testing without a MIDI keyboard: A W S E D F T G Y H U J K = C4..C5, M toggles mode.
const KEYS = 'awsedftgyhujk';
window.addEventListener('keydown', event => {
  if (event.repeat || !state.ready) return;
  const index = KEYS.indexOf(event.key.toLowerCase());
  if (index >= 0) playNote(60 + index);
  else if (event.key.toLowerCase() === 'm') setMode(state.mode === 'musical' ? 'scientific' : 'musical');
});

// ---- Drawing ----
const wave = document.querySelector('#timeseries'), spec = document.querySelector('#spectrogram');
const wctx = wave.getContext('2d'), sctx = spec.getContext('2d');
let lastFrame = null, carry = 0;
const freqData = new Float32Array(4096);
const ENVELOPE_SLOTS = 2048;   // > 4.5 s of 256-sample blocks at 48 kHz
const envelopeBlock = new Float64Array(ENVELOPE_SLOTS).fill(-1), envelopeLo = new Float32Array(ENVELOPE_SLOTS), envelopeHi = new Float32Array(ENVELOPE_SLOTS);

function drawTimeseries() {
  // Redraw the whole strip from the recorded envelope; newest audio at the right edge.
  const rate = context.sampleRate, newest = Math.floor(context.currentTime * rate / BLOCK);
  const span = Math.round(WINDOW_SECONDS * rate / BLOCK);
  let peak = 0.02;   // auto-scale to the loudest block on screen
  for (let b = newest - span; b <= newest; b++) {
    const slot = ((b % ENVELOPE_SLOTS) + ENVELOPE_SLOTS) % ENVELOPE_SLOTS;
    if (envelopeBlock[slot] === b) peak = Math.max(peak, -envelopeLo[slot], envelopeHi[slot]);
  }
  const mid = wave.height / 2, scale = wave.height * 0.45 / peak;
  wctx.clearRect(0, 0, wave.width, wave.height);
  wctx.fillStyle = css('--signal');
  for (let x = 0; x < wave.width; x++) {
    const first = newest - span + Math.floor(x * span / wave.width), last = newest - span + Math.floor((x + 1) * span / wave.width);
    let lo = 0, hi = 0;
    for (let b = first; b <= Math.max(first, last - 1); b++) {
      const slot = ((b % ENVELOPE_SLOTS) + ENVELOPE_SLOTS) % ENVELOPE_SLOTS;
      if (envelopeBlock[slot] === b) { lo = Math.min(lo, envelopeLo[slot]); hi = Math.max(hi, envelopeHi[slot]); }
    }
    wctx.fillRect(x, mid - hi * scale, 1, Math.max(1, (hi - lo) * scale));
  }
}

function fit(canvas) {
  const {width, height} = canvas.getBoundingClientRect();
  const ratio = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
}

function colourMap(t) {
  // Panel → purple → blue → cyan → white, matching the site palette.
  const stops = [css('--panel'), css('--brand-purple'), css('--accent'), css('--signal'), '#ffffff'].map(hex =>
    [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1), i = Math.floor(x), f = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
}
let palette = null;

function frame(now) {
  requestAnimationFrame(frame);
  fit(wave); fit(spec);
  if (!wave.width || !wave.height || !spec.width || !spec.height) return;   // not laid out yet
  palette ??= Array.from({length: 256}, (_, i) => colourMap(i / 255));
  const dt = lastFrame === null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  carry += dt * wave.width / WINDOW_SECONDS;
  const shift = Math.floor(carry); carry -= shift;
  if (!shift) return;

  drawTimeseries();

  // Spectrogram: scroll left and paint one column per new pixel on a log-frequency axis.
  analyser.getFloatFrequencyData(freqData);
  sctx.drawImage(spec, -shift, 0);
  const column = sctx.createImageData(shift, spec.height);
  const binHz = context.sampleRate / analyser.fftSize, top = analyser.maxDecibels, floor = top - 70;
  for (let y = 0; y < spec.height; y++) {
    const frequency = F_LOW * (F_HIGH / F_LOW) ** (1 - y / spec.height);
    const db = freqData[Math.min(freqData.length - 1, Math.round(frequency / binHz))];
    const [r, g, b] = palette[Math.max(0, Math.min(255, Math.round((db - floor) / (top - floor) * 255)))];
    for (let x = 0; x < shift; x++) { const i = (y * shift + x) * 4; column.data.set([r, g, b, 255], i); }
  }
  sctx.putImageData(column, spec.width - shift, 0);
  drawMarkers();
}

function drawMarkers() {
  // Note labels follow their onset as it scrolls left across the timeseries.
  const layer = document.querySelector('#markers');
  const nowTime = context.currentTime;
  while (markers.length && nowTime - markers[0].time > WINDOW_SECONDS) markers.shift();
  // Skip labels closer than 0.6 s to the previous one, so dense detection runs stay readable.
  let previous = -Infinity;
  const shown = markers.filter(m => {
    if (!m.label || m.time > nowTime || m.time - previous < 0.6) return false;
    previous = m.time; return true;
  });
  layer.replaceChildren(...shown.map(m => {
    const tag = document.createElement('span');
    tag.textContent = m.label;
    tag.style.left = `${100 * (1 - (nowTime - m.time) / WINDOW_SECONDS)}%`;
    tag.style.borderColor = tag.style.color = m.colour;
    return tag;
  }));
}

function drawHistogram() {
  const svg = document.querySelector('#histogram');
  const catalogMasses = catalog.events.flatMap(event => event.masses);
  const bins = massBins(catalogMasses, 2, 150);
  const count = bins.edges.length - 1;
  const catalogCounts = new Array(count).fill(0), playedCounts = new Array(count).fill(0);
  for (const mass of catalogMasses) if (mass < 150) catalogCounts[bins.index(mass)]++;
  for (const mass of state.played) if (mass < 150) playedCounts[bins.index(mass)]++;
  const peak = Math.max(1, ...catalogCounts, ...playedCounts);
  const sounding = state.lastNote ? bins.index(state.lastNote.mass) : -1;
  const W = 1000, H = 160, bw = W / count;
  const bars = (counts, fill) => counts.map((n, i) => n ?
    `<rect x="${(i * bw).toFixed(1)}" y="${(H - H * n / peak).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(H * n / peak).toFixed(1)}" fill="${fill(i)}"/>` : '').join('');
  // One rainbow line per key at its component mass, coloured by pitch class as on the main page.
  const noteColor = midi => `hsl(${((midi - 21) % 12 + 12) % 12 * 25}, 85%, 70%)`;
  const labelRowEnds = [];
  let keyLines = '', keyLabels = '';
  for (const note of [...notes].sort((p, q) => p.mass - q.mass)) {
    if (note.mass > 150) continue;
    const x = W * bins.position(note.mass), color = noteColor(note.midi);
    const selected = state.lastNote?.midi === note.midi;
    keyLines += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${H}" stroke="${color}" stroke-opacity="${selected ? 0.9 : 0.45}" stroke-width="${selected ? 3 : 1}"/>`;
    // Label the low keys, every other key to A3, and every A above, as on the main page.
    if (note.midi <= 45 || (note.midi <= 57 && (note.midi - 45) % 2 === 0) || note.midi % 12 === 9) {
      const labelX = x + 4, width = note.name.length * 7.5;
      let row = labelRowEnds.findIndex(end => labelX >= end + 5);
      if (row === -1) row = labelRowEnds.length;
      labelRowEnds[row] = labelX + width;
      const y = 14 + row * 16;
      keyLabels += `<rect x="${(labelX - 2).toFixed(1)}" y="${y - 12}" width="${width + 4}" height="15" rx="2" fill="var(--panel)"/>` +
        `<text x="${labelX.toFixed(1)}" y="${y}" style="fill:${color};font-weight:${selected ? 800 : 500}">${note.name}</text>`;
    }
  }
  const ticks = [0, 25, 50, 75, 100, 125, 150].map(m =>
    `<text x="${W * m / 150}" y="${H + 18}" text-anchor="middle">${m}${m === 150 ? ' M☉' : ''}</text>`).join('');
  svg.innerHTML = `<defs><pattern id="stripe" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="8" height="8" fill="var(--signal)" opacity=".35"/><rect width="3" height="8" fill="var(--signal)"/></pattern></defs>
    ${keyLines}${bars(catalogCounts, () => 'var(--catalog)')}${bars(playedCounts, i => i === sounding ? '#fff' : 'url(#stripe)')}
    <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--line)"/>${ticks}${keyLabels}`;
  document.querySelector('#played-count').textContent = `${state.played.length} components played`;
}

// Chromium on the stand runs with --autoplay-policy=no-user-gesture-required,
// so audio starts without a tap; elsewhere the first click or key starts it.
const boot = () => { if (!context) start().catch(error => { document.querySelector('#status').textContent = `Could not start: ${error.message}`; }); };
boot();
connectMidi();
window.addEventListener('pointerdown', () => context?.resume());
window.addEventListener('keydown', () => context?.resume());
