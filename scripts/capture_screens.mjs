// Capture the stand guide's screen previews from the real kiosk pages in headless Chrome.
//
// Serves dist/ locally, opens kiosk-live.html (1280x800) and kiosk-controls.html (1280x720) in one
// browser so the controls page mirrors the live display, plays a few notes in both modes, and writes
// docs/images/screen-waveform.png and docs/images/screen-touch.png.
//
// Usage: node scripts/capture_screens.mjs   (after gw-piano --output dist)
// Set CHROME to use a different Chrome or Chromium binary.
import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = 8765, DEBUG_PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const debug = (...args) => { if (process.env.DEBUG) console.error('[capture]', ...args); };

const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'dist')], {stdio: 'ignore'});
const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'gw-capture-'))}`, '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', 'about:blank'], {stdio: 'ignore'});

async function json(path, method = 'GET') {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${DEBUG_PORT}${path}`, {method})).json(); }
    catch { await sleep(200); }   // Chrome still starting
  }
  throw new Error('Chrome debugging port did not open');
}

/** Open a page in its own tab and return a small DevTools Protocol client for it. */
async function open(url, width, height) {
  const target = await json(`/json/new?about:blank`, 'PUT');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, {once: true}));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({data}) => {
    const msg = JSON.parse(data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const n = ++id; pending.set(n, msg => msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result));
    ws.send(JSON.stringify({id: n, method, params}));
  });
  const evaluate = async expression => (await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true})).result.value;
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: `http://127.0.0.1:${HTTP_PORT}/${url}`});
  await sleep(1000);
  return {send, evaluate, close: () => ws.close()};
}

async function shot(page, file) {
  const {data} = await page.send('Page.captureScreenshot', {format: 'png'});
  writeFileSync(join(ROOT, 'docs', 'images', file), Buffer.from(data, 'base64'));
  console.log(`Wrote docs/images/${file}`);
}

try {
  await json('/json/version');
  const live = await open('kiosk-live.html', 1280, 800);
  // Wait for every sample to load; the status line empties when the display is ready.
  for (let i = 0; i < 120 && await live.evaluate("document.querySelector('#status').textContent"); i++) await sleep(500);
  debug('live display ready');
  // Two scientific notes, switch to musical, two more; all inside the 4.5 s scrolling window.
  await live.evaluate(`(async () => {
    const key = k => window.dispatchEvent(new KeyboardEvent('keydown', {key: k}));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    key('a'); await wait(900); key('t'); await wait(900); key('m'); await wait(200);
    key('d'); await wait(900); key('k');
  })()`);
  await sleep(1300);
  await shot(live, 'screen-waveform.png');
  // The controls page asks the live display for its state on load, so it shows the ready, musical layout.
  const controls = await open('kiosk-controls.html', 1280, 720);
  await sleep(1000);
  await shot(controls, 'screen-touch.png');
  live.close(); controls.close();
} finally {
  chrome.kill(); server.kill();
}
