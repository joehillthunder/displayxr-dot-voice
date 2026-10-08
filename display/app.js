// The display: listens to the bridge over WebSocket and turns each command into one
// @displayxr/inline3d call. Outside the DisplayXR Browser every call still renders, flat.
//
// URL fragment (never sent to a server): #secret=<BRIDGE_SECRET>&bridge=<ws url>
// Query: ?kiosk (full-screen stage, no page furniture)

import { createInline3D, inline3dDisplayModesSupported } from '@displayxr/inline3d';
import { addModel } from '@displayxr/inline3d/model';
import { addSplat } from '@displayxr/inline3d/splat/playcanvas';

const $ = (id) => document.getElementById(id);
const log = (...a) => {
  console.log('[display]', ...a);
  $('log').textContent = `${new Date().toTimeString().slice(0, 8)}  ${a.join(' ')}\n` + $('log').textContent.slice(0, 2000);
};

if (new URLSearchParams(location.search).has('kiosk')) document.body.classList.add('kiosk');

// ── config from the fragment, kept for this tab only ────────────────────────────────────────
const frag = new URLSearchParams(location.hash.slice(1));
if (frag.get('secret')) sessionStorage.setItem('dxr.secret', frag.get('secret'));
if (frag.get('bridge')) sessionStorage.setItem('dxr.bridge', frag.get('bridge'));
if (location.hash) history.replaceState(null, '', location.pathname + location.search); // keep the secret out of history
const SECRET = sessionStorage.getItem('dxr.secret') || '';
const SERVED_BY_BRIDGE = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);
const BRIDGE_URL = sessionStorage.getItem('dxr.bridge')
  || (SERVED_BY_BRIDGE ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` : 'ws://localhost:8787/ws');

const ASSETS_BASE = new URL('../assets/', location.href);
const EXT = { model: ['.glb', '.gltf'], splat: ['.ply', '.sog'] };

// ── state ──────────────────────────────────────────────────────────────────────────────────
const wall = await createInline3D({ lazy: false });
const S = { content: { kind: 'none' }, mode: '3d', woven: !!wall.supported, invite: null };
let handle = null;
let call = null;
let catalog = [];

try {
  catalog = (await (await fetch(new URL('catalog.json', ASSETS_BASE))).json()).assets;
} catch (e) {
  log('could not load the asset catalog:', e.message);
}

// ── rendering ──────────────────────────────────────────────────────────────────────────────
function cover(text) {
  $('cover-text').textContent = text;
  $('cover').hidden = false;
}

function resolve(kind, args) {
  if (args.name) {
    const entry = catalog.find((a) => a.name === String(args.name));
    if (!entry) throw new Error(`Unknown asset "${args.name}".`);
    if (entry.kind !== kind) throw new Error(`"${entry.name}" is a ${entry.kind}.`);
    return { name: entry.name, url: entry.url || new URL(entry.path, ASSETS_BASE).href };
  }
  // The MCP server enforces the allowlist; this re-checks scheme and type.
  const u = new URL(String(args.url));
  if (u.protocol !== 'https:' && u.origin !== location.origin) throw new Error('Only https asset URLs are allowed.');
  if (!EXT[kind].some((x) => u.pathname.toLowerCase().endsWith(x))) throw new Error(`Not a ${kind} file.`);
  return { name: u.pathname.split('/').pop(), url: u.href };
}

function removeContent() {
  if (handle) { try { handle.remove(); } catch {} handle = null; }
  if (call) { try { call.leave(); } catch {} call = null; }
  $('call').hidden = true;
  $('call').replaceChildren();
  $('stage').hidden = false;
  $('tile-host').replaceChildren();
  S.content = { kind: 'none' };
  S.invite = null;
}

// A new canvas for each asset: committed with its final box, two frames before registering,
// and kept under the cover until the SDK says the first woven frame landed (woven-canvas rules 4–5).
async function freshCanvas() {
  const canvas = document.createElement('canvas');
  $('tile-host').replaceChildren(canvas);
  // Two frames, but never hang: a hidden tab gets no animation frames at all.
  await new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(r));
    setTimeout(r, 250);
  });
  return canvas;
}

async function show(kind, args) {
  const asset = resolve(kind, args);
  cover(`Loading ${asset.name}…`);
  removeContent();
  const canvas = await freshCanvas();
  const opts = { idleSpin: 10, feather: 24, renderScale: 0.6 };
  handle = kind === 'model'
    ? addModel(wall, canvas, asset.url, opts)
    : addSplat(wall, canvas, asset.url, { ...opts, engine: 'playcanvas' });
  try {
    await Promise.all([handle.ready, handle.firstWoven]);
  } catch (e) {
    removeContent();
    cover(`Could not load ${asset.name}`);
    throw new Error(`Could not load ${asset.name}: ${e?.message || e}`);
  }
  $('cover').hidden = true;
  S.content = { kind, name: asset.name, url: asset.url };
  return `showing ${asset.name}`;
}

async function setMode(mode) {
  if (mode !== '2d' && mode !== '3d') throw new Error('mode must be 2d or 3d');
  S.mode = mode;
  if (!wall.supported) return `mode ${mode} recorded (2D browser)`;
  if (!inline3dDisplayModesSupported()) throw new Error('This DisplayXR Browser has no display-mode API.');
  await wall.setStereoEnabled(mode === '3d');
  return `display ${mode}`;
}

// addCall() opens the camera and microphone before it shows its lobby (for the preview), so the
// agent's command only puts up a button. The SDK, and with it the camera, loads on a local click:
// a remote agent can invite a person at the display to call, never turn the camera on itself.
async function startCall() {
  removeContent();
  $('stage').hidden = true;
  $('call').hidden = false;
  const gate = document.createElement('div');
  gate.className = 'call-gate';
  gate.innerHTML = '<p>An agent asked to start a 3D video call. The camera and microphone stay off until you press Start.</p>';
  const start = document.createElement('button');
  start.textContent = 'Start 3D call';
  const cancel = document.createElement('button');
  cancel.textContent = 'Not now';
  gate.append(start, cancel);
  $('call').replaceChildren(gate);
  S.content = { kind: 'call' };
  cancel.onclick = () => { clear().then(() => pushState()); };
  start.onclick = async () => {
    start.disabled = true;
    try {
      const { addCall } = await import('@displayxr/inline3d/call');
      $('call').replaceChildren();
      call = await addCall(wall, $('call'), { ui: true, autoJoin: false });
      call.on('joined', () => { S.invite = call.inviteLink(); pushState(); });
    } catch (e) {
      log('call failed:', e?.message || e);
      start.disabled = false;
    }
  };
  return 'call prompt shown; waiting for a person at the display to press Start';
}

async function clear() {
  removeContent();
  cover('Waiting for a command…');
  return 'cleared';
}

const HANDLERS = {
  show_model: (a) => show('model', a),
  show_splat: (a) => show('splat', a),
  set_mode: (a) => setMode(a.mode),
  start_call: () => startCall(),
  clear: () => clear(),
};

// Commands run one at a time, in arrival order.
let queue = Promise.resolve();
function run(cmd, args) {
  const p = queue.then(() => HANDLERS[cmd](args || {}));
  queue = p.catch(() => {});
  return p;
}

// ── status overlay ─────────────────────────────────────────────────────────────────────────
function renderStatus(connected) {
  if (connected !== undefined) {
    $('st-bridge').className = 'dot ' + (connected ? 'on' : 'off');
    $('st-bridge-text').textContent = connected ? 'bridge: connected' : SECRET ? 'bridge: offline' : 'bridge: no secret';
  }
  $('st-mode').textContent = S.woven ? `3D display · ${wall.hardwareDisplayState || S.mode}` : '2D browser';
  $('st-content').textContent = S.content.kind === 'none' ? 'nothing showing' : `${S.content.kind}${S.content.name ? ': ' + S.content.name : ''}`;
}
if (wall.supported) wall.on?.('hardwaredisplaystatechange', () => { renderStatus(); pushState(); });

// ── bridge connection ──────────────────────────────────────────────────────────────────────
let ws = null;
let delay = 1000;
function pushState() {
  renderStatus();
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'state', state: S }));
}

function connect() {
  if (!SECRET) {
    renderStatus(false);
    log('no bridge secret: open this page from setup-windows.bat, or add #secret=… to the URL. Demo buttons still work.');
    return;
  }
  ws = new WebSocket(BRIDGE_URL);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', v: 1, role: 'display', secret: SECRET, name: S.woven ? 'displayxr' : 'browser-2d' }));
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'welcome') { delay = 1000; renderStatus(true); log('connected to', BRIDGE_URL); pushState(); return; }
    if (msg.type !== 'command' || !HANDLERS[msg.cmd]) return;
    log('command', msg.cmd, JSON.stringify(msg.args || {}));
    const t0 = performance.now();
    let reply;
    try {
      reply = { ok: true, message: await run(msg.cmd, msg.args) };
      log('done', msg.cmd, `${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      reply = { ok: false, message: e?.message || String(e) };
      log('error', reply.message);
    }
    renderStatus();
    ws.send(JSON.stringify({ type: 'result', id: msg.id, ...reply, state: S }));
  };
  ws.onclose = (ev) => {
    renderStatus(false);
    if (ev.code === 4003) { log('the bridge rejected the secret'); return; }
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000);
  };
}

// ── demo buttons (work with no bridge and no agent) ────────────────────────────────────────
for (const a of catalog) {
  const b = document.createElement('button');
  b.textContent = `${a.kind === 'splat' ? 'Splat' : 'Model'}: ${a.name}`;
  b.onclick = () => run(`show_${a.kind}`, { name: a.name }).then(() => pushState(), (e) => log(e.message));
  $('demo-buttons').append(b);
}
for (const [label, fn] of [['2D', () => run('set_mode', { mode: '2d' })], ['3D', () => run('set_mode', { mode: '3d' })], ['Clear', () => run('clear')]]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => fn().then(() => pushState(), (e) => log(e.message));
  $('demo-buttons').append(b);
}

renderStatus(false);
log(wall.supported ? 'inline-3D session active' : '2D fallback (not the DisplayXR Browser)');
connect();
