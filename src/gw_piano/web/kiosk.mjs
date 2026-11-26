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
import {massMarkup, setMassText} from './solar.mjs';

// Seconds between detections in Play detections in order. Each sample lasts up to 0.35 s,
// so neighbouring chirps overlap a little while staying distinct on the timeseries.
const DETECTION_SPACING = 0.2;
const MODE_CC = 20;            // CC20 0-63 scientific, 64-127 musical, as in GW-Piano.sfz
const WINDOW_SECONDS = 4.5;    // span of the scrolling timeseries and spectrogram
const MAX_LEVEL = 0.3;         // master gain cap; with the ALSA mixer, sets the stand's maximum volume
const MAX_VOICES = 24;
const BLOCK = 256;           // samples per timeseries envelope point (about 6 ms)
const F_LOW = 20, F_HIGH = 2000;
const FFT_SIZE = 8192;       // spectrogram window, matching the previous AnalyserNode resolution
const HOP = 1024;            // samples between spectrogram columns (about 21 ms)
const SPEC_ROWS = 192;       // log-frequency rows per spectrogram column
const SPEC_SLOTS = 512;      // > 4.5 s of columns at 48 kHz
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const channel = new BroadcastChannel('gw-piano-kiosk');
const state = {mode: 'scientific', busy: null, ready: false, played: [], lastNote: null};
let context, master, analyser, notes = [], byMidi = new Map(), catalog;
const buffers = {scientific: new Map(), musical: new Map()};
// Notable detections' own real-mass waveforms, keyed by catalog event name.
const landmarkBuffers = {scientific: new Map(), musical: new Map()};
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
  });
  // Spectrum recorder: Blackman-windowed FFT every HOP samples, sampled onto log-frequency rows in dB
  // (20 log10 |X| / N, the AnalyserNode convention). Rows run from F_HIGH at the top to F_LOW at the bottom.
  registerProcessor('gw-spectrum', class extends AudioWorkletProcessor {
    constructor() {
      super();
      const N = ${FFT_SIZE};
      this.ring = new Float32Array(N); this.pos = 0; this.since = 0;
      this.re = new Float64Array(N); this.im = new Float64Array(N);
      this.win = Float64Array.from({length: N}, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N));
      this.bins = Int32Array.from({length: ${SPEC_ROWS}}, (_, y) =>
        Math.min(N / 2 - 1, Math.round(${F_LOW} * (${F_HIGH} / ${F_LOW}) ** (1 - y / ${SPEC_ROWS}) / (sampleRate / N))));
    }
    fft() {
      const re = this.re, im = this.im, n = re.length;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
            const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
          }
        }
      }
    }
    process([input]) {
      const data = input[0] || new Float32Array(128), N = this.ring.length;
      for (const v of data) { this.ring[this.pos] = v; this.pos = (this.pos + 1) % N; }
      this.since += data.length;
      if (this.since < ${HOP}) return true;
      this.since = 0;
      for (let i = 0; i < N; i++) { this.re[i] = this.ring[(this.pos + i) % N] * this.win[i]; this.im[i] = 0; }
      this.fft();
      const column = new Float32Array(${SPEC_ROWS});
      for (let y = 0; y < column.length; y++) {
        const k = this.bins[y];
        column[y] = 20 * Math.log10(Math.hypot(this.re[k], this.im[k]) / N + 1e-12);
      }
      this.port.postMessage([currentFrame + data.length, column], [column.buffer]);
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
  const spectrum = new AudioWorkletNode(context, 'gw-spectrum');
  spectrum.port.onmessage = ({data: [frameIndex, column]}) => {
    const hop = Math.floor(frameIndex / HOP), slot = hop % SPEC_SLOTS;
    specHop[slot] = hop; specColumns.set(column, slot * SPEC_ROWS);
  };
  analyser.connect(spectrum);
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
  // Notable detections have their own real-mass waveforms; a missing one falls back to the retuned note.
  await Promise.all(catalog.events.filter(event => event.sample).flatMap(event =>
    [['scientific', event.sample], ['musical', event.musical_sample]].map(async ([mode, url]) => {
      try { landmarkBuffers[mode].set(event.name, await loadBuffer(url)); }
      catch (error) { console.debug('GW Piano kiosk landmark sample unavailable', url, error); }
    })));
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
  setMassText(document.querySelector('#last-note'),
    `Last note: ${note.name} · 2 × ${note.mass.toFixed(1)} M☉ · ${state.mode}`);
}

function stopAll() {
  generation++;
  for (const timer of tuneTimers) clearTimeout(timer);
  tuneTimers = [];
  batch?.stop(); batch = null;
  for (const source of voices) source.stop();
  voices.clear();
  // Drop labels for scheduled notes that will now never sound; labels already played keep scrolling with their audio.
  const now = context.currentTime;
  for (let i = markers.length - 1; i >= 0; i--) if (markers[i].time > now) markers.splice(i, 1);
  console.debug('GW Piano kiosk stop: kept', markers.length, 'played labels');
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

/** Play one notable detection, tuned to its own merger frequency. */
function playLandmark(index) {
  stopAll();
  const landmark = landmarkNotes(catalog.events, notes).find(item => item.name === landmarks[index]?.name);
  if (!landmark) { console.debug('GW Piano landmark not in catalogue', index); return; }
  const ticket = generation;
  const at = context.currentTime + 0.05;
  state.busy = `landmark-${index}`; broadcast();
  // Use the detection's own real-mass waveform when it has loaded, else the retuned nearest note.
  const own = landmarkBuffers[state.mode].get(landmark.name);
  const part = own ? {...landmark.part, playbackRate: 1} : {...landmark.part};
  batch = scheduleCatalog(context, [part], own ? () => own : note => buffers[state.mode].get(note.midi), master, at, () => {
    if (ticket === generation) { batch = null; state.busy = null; broadcast(); }
  });
  // Each component of the real binary goes on the histogram; the first carries the event label.
  landmark.event.masses.forEach((mass, i) => addPlayed(mass, i === 0 ? landmark.name : null, at, landmark.note));
  setMassText(document.querySelector('#last-note'),
    `${landmark.label} · ${landmark.title} · ${landmark.event.masses.join(' + ')} M☉`);
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

// Computer keys for testing without a MIDI keyboard: A W S E D F T G Y H U J K O L P ; ' = C4..F5, M toggles mode.
const KEYS = "awsedftgyhujkolp;'";
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
const ENVELOPE_SLOTS = 2048;   // > 4.5 s of 256-sample blocks at 48 kHz
// Spectrogram history from the gw-spectrum worklet, indexed by HOP-sample column like the envelope.
const specHop = new Float64Array(SPEC_SLOTS).fill(-1), specColumns = new Float32Array(SPEC_SLOTS * SPEC_ROWS);
const specImage = document.createElement('canvas'), specImageCtx = specImage.getContext('2d');
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

function drawSpectrogram() {
  // Redraw the whole spectrogram from the recorded columns, newest at the right edge, so time the
  // page spent hidden (no animation frames) still appears and stays aligned with the timeseries.
  const newest = Math.floor(context.currentTime * context.sampleRate / HOP);
  const span = Math.round(WINDOW_SECONDS * context.sampleRate / HOP);
  if (specImage.width !== span) { specImage.width = span; specImage.height = SPEC_ROWS; }
  const image = specImageCtx.createImageData(span, SPEC_ROWS);
  const top = analyser.maxDecibels, floor = top - 70;
  for (let x = 0; x < span; x++) {
    const hop = newest - span + 1 + x, slot = ((hop % SPEC_SLOTS) + SPEC_SLOTS) % SPEC_SLOTS, have = specHop[slot] === hop;
    for (let y = 0; y < SPEC_ROWS; y++) {
      const db = have ? specColumns[slot * SPEC_ROWS + y] : -Infinity;
      const [r, g, b] = palette[Math.max(0, Math.min(255, Math.round((db - floor) / (top - floor) * 255)))];
      image.data.set([r, g, b, 255], (y * span + x) * 4);
    }
  }
  specImageCtx.putImageData(image, 0, 0);
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(specImage, 0, 0, spec.width, spec.height);
}

function fit(canvas) {
  const {width, height} = canvas.getBoundingClientRect();
  const ratio = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
}

function colourMap(t) {
  // Panel → purple → blue → bright blue → white, from the theme colours.
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

  drawSpectrogram();
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
    setMassText(tag, m.label);
    tag.style.left = `${100 * (1 - (nowTime - m.time) / WINDOW_SECONDS)}%`;
    tag.style.borderColor = tag.style.color = m.colour;
    return tag;
  }));
}

// Redraw the histogram whenever its box changes size (window resize, full screen).
new ResizeObserver(() => { if (catalog) drawHistogram(); }).observe(document.querySelector('#histogram'));

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
  // Draw in the SVG's own pixel size (viewBox = box), so bars fill the panel and text keeps its true shape.
  const box = svg.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const font = parseFloat(getComputedStyle(svg).fontSize) || 13, row = font * 1.25;
  const W = box.width, H = box.height - font * 1.6, bw = W / count;
  svg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${box.height.toFixed(1)}`);
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
      const labelX = x + font * 0.3, width = note.name.length * font * 0.6;
      let labelRow = labelRowEnds.findIndex(end => labelX >= end + font * 0.4);
      if (labelRow === -1) labelRow = labelRowEnds.length;
      labelRowEnds[labelRow] = labelX + width;
      const y = font * 1.1 + labelRow * row;
      keyLabels += `<rect x="${(labelX - 2).toFixed(1)}" y="${(y - font * 0.95).toFixed(1)}" width="${(width + 4).toFixed(1)}" height="${(font * 1.2).toFixed(1)}" rx="2" fill="var(--panel)"/>` +
        `<text x="${labelX.toFixed(1)}" y="${y}" style="fill:${color};font-weight:${selected ? 800 : 500}">${note.name}</text>`;
    }
  }
  const ticks = [0, 25, 50, 75, 100, 125, 150].map(m =>
    `<text x="${W * m / 150}" y="${(H + font * 1.3).toFixed(1)}" text-anchor="${m === 0 ? 'start' : m === 150 ? 'end' : 'middle'}">${m}${m === 150 ? massMarkup(' M☉') : ''}</text>`).join('');
  svg.innerHTML = `<defs><pattern id="stripe" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="8" height="8" fill="var(--played)" opacity=".35"/><rect width="3" height="8" fill="var(--played)"/></pattern></defs>
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
