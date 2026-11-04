'use strict';
const status = document.querySelector('#status');
const current = document.querySelector('#current');
const keyboard = document.querySelector('#keyboard');
const shortcuts = 'awsedftgyhujk';
let context, master, manifest;
const buffers = new Map(), pending = new Map(), voices = new Set(), buttons = new Map();
let generation = 0;
const wavePath = Array.from({length: 1200}, (_, i) => {
  const t = i / 1199;
  return `${i ? 'L' : 'M'}${(t * 600).toFixed(2)},${(180 + Math.sin(12*t + 220*t**4) * (8 + 140*t**3)).toFixed(2)}`;
}).join(' ');
document.querySelector('#waveform').setAttribute('d', wavePath);
function stopAll() {
  generation++;
  for (const source of voices) source.stop();
  voices.clear();
  for (const button of buttons.values()) button.classList.remove('active');
}
document.querySelector('#stop').onclick = stopAll;
window.addEventListener('blur', stopAll);
document.querySelector('#volume').oninput = event => {
  if (master) master.gain.setTargetAtTime(Number(event.target.value), context.currentTime, 0.015);
};
async function play(note) {
  const ticket = generation;
  try {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      // Fixed headroom and a compressor keep chords under control.
      const compressor = context.createDynamicsCompressor();
      master.gain.value = Number(document.querySelector('#volume').value);
      master.connect(compressor).connect(context.destination);
    }
    await context.resume();
    if (!buffers.has(note.midi)) {
      status.textContent = `Loading ${note.name}…`;
      if (!pending.has(note.midi)) pending.set(note.midi, (async () => {
        const response = await fetch(note.file);
        if (!response.ok) throw new Error('Sample download failed');
        buffers.set(note.midi, await context.decodeAudioData(await response.arrayBuffer()));
      })().finally(() => pending.delete(note.midi)));
      await pending.get(note.midi);
    }
    if (ticket !== generation) return;
    if (voices.size >= 24) { const oldest = voices.values().next().value; oldest.stop(); voices.delete(oldest); }
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0.25;
    source.buffer = buffers.get(note.midi);
    source.connect(gain).connect(master);
    voices.add(source);
    const button = buttons.get(note.midi);
    button.classList.add('active');
    source.onended = () => {
      voices.delete(source); source.disconnect(); gain.disconnect();
      if (![...voices].some(voice => voice.note === note.midi)) button.classList.remove('active');
    };
    source.note = note.midi;
    source.start();
    played.push(note.mass, note.mass);
    drawHistogram();
    current.textContent = `${note.name} / ${note.frequency.toFixed(2)} Hz / ${note.mass.toFixed(1)} + ${note.mass.toFixed(1)} M☉`;
    status.textContent = 'One-shot chirps · play multiple keys for a chord';
  } catch (error) { status.textContent = `Could not play audio. ${error.message}. Try again.`; }
}
async function setup() {
  const response = await fetch('manifest.json');
  if (!response.ok) throw new Error('Could not load note manifest');
  manifest = await response.json();
  const whites = manifest.notes.filter(note => !note.name.includes('#')).length;
  const shortcutStart = manifest.notes.findIndex(note => note.midi === 60);
  const start = shortcutStart >= 0 ? shortcutStart : 0;
  const mapped = manifest.notes.slice(start, start + shortcuts.length);
  let whiteIndex = 0;
  for (const note of manifest.notes) {
    const black = note.name.includes('#');
    const button = document.createElement('button');
    button.className = `key ${black ? 'black' : 'white'}`;
    const position = black ? whiteIndex - 0.32 : whiteIndex++;
    button.style.left = `${Math.max(0, position) / whites * 100}%`;
    button.style.width = `${(black ? 0.64 : 1) / whites * 100}%`;
    button.setAttribute('aria-label', `${note.name}, ${note.frequency.toFixed(2)} hertz`);
    const label = document.createElement('span'); label.textContent = note.name;
    const key = document.createElement('kbd');
    key.textContent = mapped.includes(note) ? shortcuts[mapped.indexOf(note)].toUpperCase() : '';
    button.append(label, key);
    // Start on contact so independent fingers can trigger a chord.
    button.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      button.focus({preventScroll: true});
      play(note);
    });
    button.onclick = event => { if (event.detail === 0) play(note); };
    keyboard.append(button); buttons.set(note.midi, button);
  }
  document.addEventListener('keydown', event => {
    if (!document.querySelector('#shortcuts').checked) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|BUTTON|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    const index = shortcuts.indexOf(event.key.toLowerCase());
    if (index >= 0 && mapped[index]) { event.preventDefault(); play(mapped[index]); }
    if (event.code === 'Space') { event.preventDefault(); stopAll(); }
  });
  document.querySelector('#range').textContent = `${manifest.notes[0].name} — ${manifest.notes.at(-1).name} / ${manifest.notes.length} SAMPLES`;
  document.querySelector('#pack-info').textContent = `${manifest.pack.count}-key sound pack · ${manifest.pack.first}–${manifest.pack.last} · WAV + SFZ · 44.1 kHz`;
  status.textContent = 'Ready · select a key to enable audio';
}
setup().catch(error => { status.textContent = `${error.message}. Serve this folder over HTTP.`; });

let catalog = null;
const played = [];
const ns = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes, text) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function drawHistogram() {
  if (!catalog) return;
  const observed = catalog.events.flatMap(event => event.masses);
  const max = Math.max(100, ...observed, ...manifest.notes.map(note => note.mass));
  const binWidth = Math.ceil(max / 20 / 5) * 5;
  const bins = Math.ceil(max / binWidth);
  const count = values => {
    const result = Array(bins).fill(0);
    for (const value of values) result[Math.min(bins - 1, Math.floor(value / binWidth))]++;
    return result;
  };
  const a = count(observed), b = count(played);
  const percentages = (values, total) => values.map(value => total ? value / total * 100 : 0);
  const pa = percentages(a, observed.length), pb = percentages(b, played.length);
  const ymax = Math.max(10, Math.ceil(Math.max(...pa, ...pb) / 10) * 10);
  const svg = document.querySelector('#histogram'); svg.replaceChildren();
  const defs = svgElement('defs', {});
  const stripes = svgElement('pattern', {id:'played-stripes', patternUnits:'userSpaceOnUse', width:8, height:8});
  stripes.append(svgElement('path', {d:'M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6', stroke:'#c6f078', 'stroke-width':3}));
  defs.append(stripes); svg.append(defs);
  for (let i = 0; i <= 4; i++) {
    const y = 265 - i * 60;
    svg.append(svgElement('line', {x1: 60, x2: 980, y1:y, y2:y, stroke:'#34413b'}));
    svg.append(svgElement('text', {x: 48, y:y+4, 'text-anchor':'end'}, `${(ymax*i/4).toFixed(0)}%`));
  }
  const table = document.querySelector('#bin-table'); table.replaceChildren();
  for (let i = 0; i < bins; i++) {
    const x = 60 + i * 920 / bins, width = 920 / bins;
    for (const [values, color, isPlayed] of [[pa,'#b077cf',false],[pb,'url(#played-stripes)',true]]) {
      const height = values[i] / ymax * 240;
      const bar = svgElement('rect', {x:x+(isPlayed ? width*0.2 : 1), y:265-height, width:isPlayed ? width*0.6 : width-2, height, fill:color, stroke:isPlayed ? '#ffffff' : 'none', 'stroke-width':isPlayed ? 2 : 0});
      bar.append(svgElement('title', {}, `${i*binWidth}–${(i+1)*binWidth} M☉: ${values[i].toFixed(2)}%`)); svg.append(bar);
    }
    if (i % Math.ceil(bins/10) === 0) svg.append(svgElement('text', {x, y:289}, i*binWidth));
    const row = document.createElement('tr');
    for (const value of [`${i*binWidth}–${(i+1)*binWidth}`,a[i],b[i]]) { const cell = document.createElement('td'); cell.textContent=value; row.append(cell); }
    table.append(row);
  }
  svg.append(svgElement('text', {x:520,y:320,'text-anchor':'middle'}, 'Component mass / M☉ (linear bins)'));
  document.querySelector('#chart-status').textContent = `${observed.length} catalog components · ${played.length/2} notes played / ${played.length} played components`;
}
document.querySelector('#reset').onclick = () => { played.length = 0; drawHistogram(); };
fetch('catalog.json').then(response => { if (!response.ok) throw new Error('Catalog download failed'); return response.json(); }).then(async data => {
  catalog = data;
  document.querySelector('#catalog-info').textContent = `GWOSC snapshot: ${data.retrieved}. ${data.events.length} events. ${data.selection}`;
  // The instrument manifest supplies the histogram range, including every playable mass.
  if (!manifest) { const response = await fetch('manifest.json'); manifest = await response.json(); }
  drawHistogram();
}).catch(error => { document.querySelector('#chart-status').textContent = `Catalog unavailable: ${error.message}`; });

const instrument = document.querySelector('#instrument');
const fullscreenButton = document.querySelector('#fullscreen');
let outreachMode = false;
const previousInert = new Map();
function setOutreachMode(enabled) {
  outreachMode = enabled;
  instrument.classList.toggle('outreach', enabled);
  document.body.classList.toggle('outreach-open', enabled);
  fullscreenButton.textContent = enabled ? 'Exit full screen ↙' : 'Full screen ↗';
  fullscreenButton.setAttribute('aria-pressed', String(enabled));
  for (const sibling of document.querySelector('main').children) {
    if (sibling === instrument) continue;
    if (enabled) { previousInert.set(sibling, sibling.inert); sibling.inert = true; }
    else if (previousInert.has(sibling)) sibling.inert = previousInert.get(sibling);
  }
  if (!enabled) previousInert.clear();
  fullscreenButton.focus({preventScroll: true});
}
async function exitOutreach() {
  stopAll();
  if (document.fullscreenElement === instrument) {
    try { await document.exitFullscreen(); } catch (_) { /* Keep the visible exit available. */ }
  }
  setOutreachMode(false);
}
fullscreenButton.addEventListener('click', async () => {
  if (outreachMode) { await exitOutreach(); return; }
  setOutreachMode(true);
  // Unsupported tablet browsers keep the same layout within the browser window.
  if (instrument.requestFullscreen && document.fullscreenEnabled) {
    try { await instrument.requestFullscreen(); } catch (_) { /* Window-filling mode remains usable. */ }
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && outreachMode) { stopAll(); setOutreachMode(false); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && outreachMode) exitOutreach();
});
