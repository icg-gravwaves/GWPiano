import {eventTimeline, observingRuns} from './timeline.mjs';
import {musicalSample} from './musical.mjs';
import {massBins} from './histogram.mjs';
import {catalogPlan, scheduleCatalog, activeNotes} from './catalog-audio.mjs';

'use strict';
const status = document.querySelector('#status');
const current = document.querySelector('#current');
const keyboard = document.querySelector('#keyboard');
const shortcuts = 'awsedftgyhujk';
let context, master, manifest;
let loadingAudio = false;
const buffers = new Map(), musicalBuffers = new Map(), voices = new Set(), buttons = new Map();
let generation = 0;
const eventsButton = document.querySelector('#play-events');
const pendingBuffers = new Map();
let catalogLoading = null;
let catalogBusy = false, ensembleSource = null;
let markerFrame = 0;
const soundingManual = new Map();
let soundingCatalog = [];
function updateSoundingBars() {
  const masses = [...soundingCatalog, ...soundingManual.values()];
  document.querySelectorAll('.played-bar').forEach(bar => {
    bar.classList.toggle('sounding-bin', masses.some(mass => mass >= Number(bar.dataset.low) && mass < Number(bar.dataset.high)));
  });
}
function clearHighlights() {
  cancelAnimationFrame(markerFrame);
  soundingCatalog = [];
  updateSoundingBars();
  document.querySelectorAll('.sounding-note').forEach(element => {
    element.classList.remove('sounding-note', 'sounding-bin');
  });
}
function highlightTimeline(plan, start, ticket, progress = () => {}) {
  const update = () => {
    if (ticket !== generation || !ensembleSource) { clearHighlights(); return; }
    const elapsed = context.currentTime - start;
    progress(elapsed);
    const active = activeNotes(plan, elapsed);
    const masses = plan.filter(part => elapsed >= part.offset && elapsed < part.offset + part.duration).map(part => part.mass);
    soundingCatalog = masses;
    updateSoundingBars();
    document.querySelectorAll('.note-marker, .note-label').forEach(element => {
      element.classList.toggle('sounding-note', active.has(Number(element.dataset.midi)));
    });
    markerFrame = requestAnimationFrame(update);
  };
  update();
}
const wavePath = Array.from({length: 1200}, (_, i) => {
  const t = i / 1199;
  return `${i ? 'L' : 'M'}${(t * 600).toFixed(2)},${(180 + Math.sin(12*t + 220*t**4) * (8 + 140*t**3)).toFixed(2)}`;
}).join(' ');
document.querySelector('#waveform').setAttribute('d', wavePath);
function stopAll() {
  generation++;
  soundingManual.clear();
  clearHighlights();
  for (const source of voices) source.stop();
  voices.clear();
  for (const button of buttons.values()) button.classList.remove('active');
  ensembleSource = null;
  catalogBusy = false;
  eventsButton.textContent = 'Play detections in order';
  eventsButton.dataset.state = 'idle';
}
document.querySelector('#stop').onclick = stopAll;
function describeMode() {
  const musical = document.querySelector('#musical-mode').checked;
  document.querySelector('#mode-description').textContent = musical
    ? 'Musical: short model chirp + 350 ms decaying tone at the note frequency. The tone is synthetic.'
    : 'Scientific: full IMRPhenomD waveform, including its quiet lead-in; no added tone.';
}
document.querySelector('#musical-mode').addEventListener('change', () => {
  stopAll();
  describeMode();
  warmCatalog();
  status.textContent = document.querySelector('#musical-mode').checked
    ? 'Musical mode selected · short chirp + synthetic note tone'
    : 'Scientific mode selected · full waveform with quiet lead-in';
});
describeMode();
window.addEventListener('blur', stopAll);
document.querySelector('#volume').oninput = event => {
  if (master) master.gain.setTargetAtTime(Number(event.target.value), context.currentTime, 0.015);
};
function createAudio() {
  if (context) return;
  context = new AudioContext({latencyHint: 'interactive'});
  master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  master.gain.value = Number(document.querySelector('#volume').value);
  master.connect(compressor).connect(context.destination);
}
async function referenceBuffer(note) {
  if (buffers.has(note.midi)) return buffers.get(note.midi);
  if (!pendingBuffers.has(note.midi)) {
    pendingBuffers.set(note.midi, (async () => {
      const response = await fetch(note.file);
      if (!response.ok) throw new Error(`Sample download failed: ${response.status}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      buffers.set(note.midi, buffer);
      return buffer;
    })().finally(() => pendingBuffers.delete(note.midi)));
  }
  return pendingBuffers.get(note.midi);
}
async function noteBuffer(note) {
  const buffer = await referenceBuffer(note);
  if (!musicalBuffers.has(note.midi)) {
    const samples = musicalSample(buffer.getChannelData(0), buffer.sampleRate, note.frequency);
    const musical = context.createBuffer(1, samples.length, buffer.sampleRate);
    musical.copyToChannel(samples, 0);
    musicalBuffers.set(note.midi, musical);
  }
  return buffer;
}
async function preloadAudio() {
  if (loadingAudio) return;
  loadingAudio = true;
  const retry = document.querySelector('#retry-audio');
  retry.hidden = true;
  status.textContent = 'Preparing keyboard audio… Keys become available as sounds load.';
  try {
    createAudio();
    const queue = manifest.notes.filter(note => !musicalBuffers.has(note.midi));
    // Limit concurrent decoding to keep tablet memory and startup work bounded.
    await Promise.all(Array.from({length: 4}, async () => {
      while (queue.length) {
        const note = queue.shift();
        try {
          await noteBuffer(note);
          buttons.get(note.midi).disabled = false;
        } catch (error) { console.debug('GW Piano sample unavailable', note.name, error); }
      }
    }));
    for (const note of manifest.notes) buttons.get(note.midi).disabled = !musicalBuffers.has(note.midi);
    const missing = manifest.notes.filter(note => !musicalBuffers.has(note.midi)).length;
    retry.hidden = missing === 0;
    status.textContent = missing
      ? `${manifest.notes.length - missing} sounds ready; ${missing} unavailable. Use Retry audio to try again.`
      : 'Ready · sounds preloaded for immediate playback';
  } catch (error) {
    retry.hidden = false;
    status.textContent = `Could not prepare audio: ${error.message}. Use Retry audio.`;
  } finally { loadingAudio = false; }
}
document.querySelector('#retry-audio').addEventListener('click', preloadAudio);
async function play(note) {
  const pressedAt = performance.now();
  const ticket = generation;
  try {
    // Unavailable notes are never queued to play late after a download.
    if (!context || !buffers.has(note.midi)) return;
    if (context.state !== 'running') await context.resume();
    if (ticket !== generation) return;
    const manualVoices = [...voices].filter(voice => voice !== ensembleSource);
    if (manualVoices.length >= 24) { const oldest = manualVoices[0]; oldest.stop(); voices.delete(oldest); }
    const source = context.createBufferSource();
    const gain = context.createGain();
    const startAt = context.currentTime;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.25, startAt + 0.005);
    const musical = document.querySelector('#musical-mode').checked;
    source.buffer = (musical ? musicalBuffers : buffers).get(note.midi);
    source.connect(gain).connect(master);
    voices.add(source);
    const button = buttons.get(note.midi);
    button.classList.add('active');
    source.onended = () => {
      voices.delete(source); source.disconnect(); gain.disconnect();
      soundingManual.delete(source);
      updateSoundingBars();
      if (![...voices].some(voice => voice.note === note.midi)) button.classList.remove('active');
    };
    soundingManual.set(source, note.mass);
    source.note = note.midi;
    source.start(startAt);
    button.dataset.playbackLatencyMs = (performance.now() - pressedAt).toFixed(2);
    console.debug('GW Piano playback', {note: note.name,
      softwareLatencyMs: Number(button.dataset.playbackLatencyMs),
      mode: musical ? 'musical' : 'scientific', baseLatencySeconds: context.baseLatency});
    played.push(note.mass, note.mass);
    playedNotes++;
    latestNote = note;
    drawHistogram();
    updateSoundingBars();
    current.textContent = `${note.name} / ${note.frequency.toFixed(2)} Hz / ${note.mass.toFixed(1)} + ${note.mass.toFixed(1)} M☉`;
    status.textContent = musical ? 'Musical · short chirp + synthetic note tone' : 'Scientific · full IMRPhenomD waveform';
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
    button.disabled = true;
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
    const target = event.target;
    const editingText = target.isContentEditable || target.matches('textarea, select, input:not([type="checkbox"]):not([type="range"])');
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || editingText) return;
    const index = shortcuts.indexOf(event.key.toLowerCase());
    if (index >= 0 && mapped[index]) { event.preventDefault(); play(mapped[index]); }
    // Space retains native activation for focused buttons and checkboxes.
    if (event.code === 'Space' && !target.closest('button, input, a, summary')) { event.preventDefault(); stopAll(); }
  });
  document.querySelector('#range').textContent = `${manifest.notes[0].name} — ${manifest.notes.at(-1).name} / ${manifest.notes.length} SAMPLES`;
  document.querySelector('#pack-info').textContent = `${manifest.pack.count}-key sound pack · ${manifest.pack.first}–${manifest.pack.last} · WAV + SFZ · 44.1 kHz`;
  await preloadAudio();
}
setup().catch(error => { status.textContent = `${error.message}. Serve this folder over HTTP.`; });

let catalog = null;
let fullNotes = [];
const played = [];
let playedNotes = 0, playedEvents = 0;
let latestNote = null;
const ns = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes, text) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function drawHistogram() {
  if (!catalog || !fullNotes.length) return;
  const observed = catalog.events.flatMap(event => event.masses);
  const axis = massBins([150], 2, 150);
  const bins = axis.edges.length - 1;
  const formatMass = mass => Number(mass.toPrecision(4)).toString();
  const tickStride = Math.ceil(bins / 6 / 5) * 5;
  const count = values => {
    const result = Array(bins).fill(0);
    for (const value of values) if (value <= 150) result[axis.index(value)]++;
    return result;
  };
  const a = count(observed), b = count(played);
  const ymax = Math.max(20, Math.ceil(Math.max(...a, ...b) / 20) * 20);
  const svg = document.querySelector('#histogram'); svg.replaceChildren();
  const defs = svgElement('defs', {});
  const stripes = svgElement('pattern', {id:'played-stripes', patternUnits:'userSpaceOnUse', width:8, height:8});
  stripes.append(svgElement('path', {d:'M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6', stroke:'#c6f078', 'stroke-width':3}));
  defs.append(stripes); svg.append(defs);
  const markerLayer = svgElement('g', {class:'note-markers'});
  svg.append(markerLayer);
  for (let i = 0; i <= 4; i++) {
    const y = 305 - i * 60;
    svg.append(svgElement('line', {x1: 60, x2: 980, y1:y, y2:y, stroke:'#34413b'}));
    svg.append(svgElement('text', {x: 48, y:y+4, 'text-anchor':'end'}, `${ymax*i/4}`));
  }
  svg.append(svgElement('text', {x:60,y:48}, 'Component count'));
  const table = document.querySelector('#bin-table'); table.replaceChildren();
  for (let i = 0; i < bins; i++) {
    const x = 60 + i * 920 / bins, width = 920 / bins;
    for (const [values, color, isPlayed] of [[a,'#b077cf',false],[b,'#c6f078',true]]) {
      const height = values[i] / ymax * 240;
      const bar = svgElement('rect', {x, y:305-height, width, height, class:isPlayed ? 'played-bar' : 'observed-bar', 'data-low':axis.edges[i], 'data-high':axis.edges[i+1], fill:color, stroke:isPlayed ? '#ffffff' : 'none', 'stroke-width':isPlayed ? 1 : 0});
      bar.append(svgElement('title', {}, `${formatMass(axis.edges[i])}–${formatMass(axis.edges[i+1])} M☉: ${values[i]} components`)); svg.append(bar);
    }
    if (i % tickStride === 0) svg.append(svgElement('text', {x, y:329, 'text-anchor':'middle'}, axis.edges[i]));
    const row = document.createElement('tr');
    for (const value of [`${formatMass(axis.edges[i])}–${formatMass(axis.edges[i+1])}`,a[i],b[i]]) { const cell = document.createElement('td'); cell.textContent=value; row.append(cell); }
    table.append(row);
  }
  const overflow = played.filter(mass=>mass>150).length;
  if (overflow) {
    const row = document.createElement('tr');
    for (const value of ['>150 (off chart)',0,overflow]) { const cell=document.createElement('td');cell.textContent=value;row.append(cell); }
    table.append(row);
  }
  const noteTable = document.querySelector('#note-mass-table'); noteTable.replaceChildren();
  const noteColors = ['#c6f078', '#a8d8ff', '#e5b0ff', '#ffada8', '#ffd080', '#7ee2c4',
    '#f4b5d8', '#c0c8ff', '#f5ec97', '#91dff5', '#dbbda0', '#b4e6b8'];
  const labelRowEnds = [];
  const labelLayer = svgElement('g', {class:'note-labels'});
  for (const note of [...fullNotes].sort((a, b) => a.mass - b.mass)) {
    // Markers and bars share the same linear component-mass axis.
    const x = 60 + axis.position(note.mass) * 920;
    const selected = latestNote?.midi === note.midi;
    const color = noteColors[note.midi % 12];
    const marker = svgElement('g', {class:'note-marker', 'data-midi':note.midi});
    marker.append(svgElement('title', {}, `${note.name}: ${note.mass.toFixed(2)} M☉ per black hole; ${note.frequency.toFixed(2)} Hz`));
    marker.append(svgElement('line', {x1:x, x2:x, y1:60, y2:305,
      stroke:color, 'stroke-opacity':selected ? 0.85 : 0.45, 'stroke-width':selected ? 2.5 : 1}));
    if (note.mass <= 150 && (note.midi <= 45 || (note.midi <= 57 && (note.midi - 45) % 2 === 0) || note.midi % 12 === 9)) {
      const labelX = x + 4;
      let labelRow = labelRowEnds.findIndex(end => labelX >= end + 5);
      if (labelRow === -1) labelRow = labelRowEnds.length;
      labelRowEnds[labelRow] = labelX + note.name.length * 7;
      const labelY = 80 + labelRow * 18;
      labelLayer.append(svgElement('rect', {x:labelX-2, y:labelY-12,
        width:note.name.length*7+4, height:16, fill:'#101716', rx:2}));
      labelLayer.append(svgElement('text', {x:labelX, y:labelY, 'data-midi':note.midi,
        class:`note-label${selected ? ' played-note' : ''}`, style:`fill:${color}`}, note.name));
    }
    if (note.mass <= 150) markerLayer.append(marker);
    const row = document.createElement('tr');
    for (const value of [note.name, note.frequency.toFixed(2), note.mass.toFixed(2)]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    noteTable.append(row);
  }
  svg.append(svgElement('text', {x:980, y:329, 'text-anchor':'middle'}, axis.edges.at(-1)));
  svg.append(labelLayer);
  svg.append(svgElement('text', {x:520,y:360,'text-anchor':'middle'}, 'Component mass / M☉'));
  const activity = [playedNotes ? `${playedNotes} notes` : '', playedEvents ? `${playedEvents} catalog events` : ''].filter(Boolean).join(' + ') || '0 notes';
  document.querySelector('#chart-status').textContent = `${observed.length} catalog components · ${activity} played / ${played.length} played components${overflow ? ` · ${overflow} above 150 M☉ (off chart)` : ""}`;
}
document.querySelector('#reset').onclick = () => { stopAll(); played.length = 0; playedNotes = 0; playedEvents = 0; latestNote = null; drawHistogram(); };
Promise.all([fetch('catalog.json'), fetch('sound-pack-manifest.json')]).then(async responses => {
  if (responses.some(response => !response.ok)) throw new Error('Catalog or full piano manifest download failed');
  const [data, pack] = await Promise.all(responses.map(response => response.json()));
  catalog = data;
  fullNotes = pack.notes;
  eventsButton.disabled = false;
  document.querySelector('#catalog-info').textContent = `GWOSC snapshot: ${data.retrieved}. ${data.events.length} events. ${data.selection}`;
  drawHistogram();
  warmCatalog();
}).catch(error => { document.querySelector('#chart-status').textContent = `Catalog unavailable: ${error.message}`; });

function catalogSelection() {
  return {
    musical:document.querySelector('#musical-mode').checked,
    condensed:document.querySelector('#preserve-timeline').getAttribute('aria-checked') === 'true'
  };
}
function catalogReferences() {
  return [...new Map(catalogPlan(catalog.events, fullNotes).map(part => [part.note.midi, part.note])).values()];
}
function catalogReady() {
  return catalog && fullNotes.length && catalogReferences().every(note => musicalBuffers.has(note.midi));
}
function loadCatalogSamples() {
  if (!catalogLoading) {
    catalogLoading = (async () => {
      createAudio();
      const queue = catalogReferences().filter(note => !musicalBuffers.has(note.midi));
      await Promise.all(Array.from({length:4}, async () => {
        while (queue.length) await noteBuffer(queue.shift());
      }));
    })().finally(() => { catalogLoading = null; });
  }
  return catalogLoading;
}
async function warmCatalog() {
  if (!catalog || !fullNotes.length) return;
  const message = document.querySelector('#catalog-audio-status');
  message.textContent = catalogReady() ? 'Detection sounds ready — press Play to start.' : 'Loading note samples…';
  try {
    await loadCatalogSamples();
    message.textContent = 'Detection sounds ready — press Play to start.';
  } catch (error) {
    console.debug('GW Piano detection sample loading', error);
    message.textContent = 'Some note samples could not load. Press Play to retry.';
  }
}
const timingButtons = [...document.querySelectorAll('.timeline-toggle [role="radio"]')];
function selectTiming(button) {
  for (const option of timingButtons) {
    const selected = option === button;
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
  warmCatalog();
}
for (const button of timingButtons) {
  button.addEventListener('click', () => selectTiming(button));
  button.addEventListener('keydown', event => {
    const index = timingButtons.indexOf(button);
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % timingButtons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + timingButtons.length - 1) % timingButtons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = timingButtons.length - 1;
    else return;
    event.preventDefault();
    selectTiming(timingButtons[next]);
    timingButtons[next].focus();
  });
}

async function playCatalog() {
  const pressedAt = performance.now();
  if (catalogBusy || ensembleSource) { stopAll(); return; }
  if (!catalog || !fullNotes.length) return;
  stopAll();
  const ticket = generation;
  catalogBusy = true;
  const {musical, condensed} = catalogSelection();
  const mode = musical ? 'musical' : 'scientific';
  try {
    createAudio();
    if (context.state !== 'running') await context.resume();
    if (!catalogReady()) {
      eventsButton.textContent = 'Cancel loading sounds';
      eventsButton.dataset.state = 'preparing';
      status.textContent = 'Loading detection sounds…';
    }
    if (!catalogReady()) await loadCatalogSamples();
    const plan = catalogPlan(eventTimeline(catalog.events, condensed, 30), fullNotes, 0.1);
    eventsButton.dataset.timelineSeconds = String(plan.at(-1).offset);
    if (ticket !== generation) return;
    const start = context.currentTime + 0.02;
    let nextComponent = 0;
    const startedEvents = new Set();
    const firstGPS = Math.min(...catalog.events.map(event => event.gps));
    const lastGPS = Math.max(...catalog.events.map(event => event.gps));
    const timeline = document.querySelector('#detection-timeline');
    timeline.hidden = false;
    const segments = document.querySelector('#run-segments');
    segments.replaceChildren();
    for (const run of observingRuns) {
      if (run.end < firstGPS || run.start > lastGPS) continue;
      const segment = document.createElement('a');
      segment.href = run.url; segment.textContent = run.name;
      segment.style.left = `${Math.max(0,(run.start-firstGPS)/(lastGPS-firstGPS))*100}%`;
      segment.style.width = `${(Math.min(lastGPS,run.end)-Math.max(firstGPS,run.start))/(lastGPS-firstGPS)*100}%`;
      segments.append(segment);
    }
    const progress = elapsed => {
      const fraction = Math.max(0,Math.min(1,elapsed/plan.at(-1).offset));
      const lastStarted = plan.filter(part => part.offset <= elapsed).at(-1);
      const gps = condensed ? firstGPS + fraction*(lastGPS-firstGPS) : lastStarted ? catalog.events.find(event=>event.name===lastStarted.event).gps : firstGPS;
      const run = observingRuns.find(run=>gps>=run.start && gps<=run.end);
      document.querySelector('#timeline-cursor').style.left = `${(gps-firstGPS)/(lastGPS-firstGPS)*100}%`;
      document.querySelector('#timeline-date').textContent = `${new Date(Date.parse(catalog.events.find(event=>event.gps===firstGPS).utc)+(gps-firstGPS)*1000).toISOString().slice(0,10)} · ${run?.name || 'Between observing runs'}${lastStarted ? ` · Latest: ${lastStarted.event}` : ''}`;

      const before = nextComponent;
      while (nextComponent < plan.length && plan[nextComponent].offset <= elapsed) {
        const part = plan[nextComponent++];
        played.push(part.mass);
        startedEvents.add(part.event);
      }
      if (nextComponent !== before) {
        playedEvents = startedEvents.size;
        drawHistogram();
        if (nextComponent === plan.length) document.querySelector('#chart-status').textContent += ' · matches catalog';
      }
    };
    const source = scheduleCatalog(context, plan, note => (musical ? musicalBuffers : buffers).get(note.midi), master, start, () => {
      voices.delete(source);
      if (ensembleSource === source) {
        progress(context.currentTime - start);
        ensembleSource = null;
        clearHighlights();
        eventsButton.textContent = 'Play detections in order';
        eventsButton.dataset.state = 'idle';
        status.textContent = 'Detection playback finished.';
      }
    });
    ensembleSource = source;
    voices.add(source);
    eventsButton.dataset.playbackLatencyMs = (performance.now() - pressedAt + 20).toFixed(1);
    console.debug('GW Piano lookup playback', {latencyMs:Number(eventsButton.dataset.playbackLatencyMs), components:plan.length});
    played.length = 0;
    playedNotes = 0;
    playedEvents = 0;
    latestNote = null;
    drawHistogram();
    highlightTimeline(plan, start, ticket, progress);
    eventsButton.textContent = 'Stop all events';
    eventsButton.dataset.state = 'playing';
    eventsButton.dataset.components = String(plan.length);
    eventsButton.dataset.events = String(catalog.events.length);
    current.textContent = `${catalog.events.length} catalog events in time order`;
    status.textContent = `Playing all ${plan.length} catalog component sounds ${condensed ? "on a 30-second calendar timeline" : "in time order (100 ms apart)"} · ${mode} mode`;
  } catch (error) {
    if (ticket === generation) {
      eventsButton.textContent = 'Play detections in order';
      eventsButton.dataset.state = 'idle';
      status.textContent = `Could not play catalog: ${error.message}. Try again.`;
    }
  } finally { if (ticket === generation) catalogBusy = false; }
}
eventsButton.addEventListener('click', playCatalog);

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
