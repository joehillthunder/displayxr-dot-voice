// The bridge: a WebSocket relay between controllers (the MCP server) and display pages, plus a
// static file server for /display and /assets, so the display runs on http://localhost (a secure
// context, which WebXR needs).
//
// Auth: every socket must send {type:'hello', secret} within HELLO_TIMEOUT_MS. The secret is
// BRIDGE_SECRET from .env. Browsers cannot set headers on a WebSocket, so it rides in the first
// message, never in the URL (URLs end up in logs).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { env, secretEnv, repoRoot } from '../shared/env.ts';
import {
  PROTOCOL_VERSION, MAX_MESSAGE_BYTES, isCommand,
  type CommandMsg, type ResultMsg, type Role,
} from '../shared/protocol.ts';

const PORT = Number(env('BRIDGE_PORT', '8787'));
const HOST = env('BRIDGE_HOST', '127.0.0.1');
const SECRET_HASH = sha(secretEnv('BRIDGE_SECRET'));
const HELLO_TIMEOUT_MS = 3000;
const COMMAND_TIMEOUT_MS = 20000;
const MAX_MSGS_PER_10S = 50;

function sha(s: string) { return createHash('sha256').update(s).digest(); }
function log(...a: unknown[]) { console.log(new Date().toISOString().slice(11, 19), '[bridge]', ...a); }

// ── static files ────────────────────────────────────────────────────────────────────────────
const STATIC_ROOTS: Record<string, string> = {
  '/display/': join(repoRoot, 'display'),
  '/assets/': join(repoRoot, 'assets'),
};
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ply': 'application/octet-stream',
  '.sog': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/' || url.pathname === '/display') {
    res.writeHead(302, { location: '/display/' }).end();
    return;
  }
  for (const [prefix, dir] of Object.entries(STATIC_ROOTS)) {
    if (!url.pathname.startsWith(prefix)) continue;
    let file: string;
    try {
      file = normalize(join(dir, decodeURIComponent(url.pathname.slice(prefix.length))));
    } catch { break; }
    if (file !== dir && !file.startsWith(dir + sep)) break; // path traversal
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch { break; }
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      // A display opened from GitHub Pages may still load assets from this bridge.
      'access-control-allow-origin': '*',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
}

const http = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true, displays: displays.size, controllers: controllers.size }));
    return;
  }
  serveStatic(req, res);
});

// ── relay ───────────────────────────────────────────────────────────────────────────────────
interface Peer { ws: WebSocket; role: Role; name: string; msgTimes: number[] }
const displays = new Set<Peer>();
const controllers = new Set<Peer>();
/** command id → the controller waiting for its result */
const pending = new Map<string, { from: Peer; timer: NodeJS.Timeout }>();
let lastState: unknown = null;

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws, req) => {
  let peer: Peer | null = null;
  const helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), HELLO_TIMEOUT_MS);

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return ws.close(4002, 'text only');
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return ws.close(4002, 'bad json'); }
    if (!msg || typeof msg !== 'object') return ws.close(4002, 'bad message');

    if (!peer) {
      if (msg.type !== 'hello' || typeof msg.secret !== 'string' || (msg.role !== 'display' && msg.role !== 'controller')) {
        return ws.close(4003, 'expected hello');
      }
      if (!timingSafeEqual(sha(msg.secret), SECRET_HASH)) {
        log('rejected bad secret from', req.socket.remoteAddress);
        return ws.close(4003, 'bad secret');
      }
      clearTimeout(helloTimer);
      peer = { ws, role: msg.role, name: String(msg.name || msg.role).slice(0, 40), msgTimes: [] };
      (peer.role === 'display' ? displays : controllers).add(peer);
      ws.send(JSON.stringify({ type: 'welcome', v: PROTOCOL_VERSION, role: peer.role }));
      log(`${peer.role} connected (${peer.name}) from ${req.socket.remoteAddress}; displays=${displays.size}`);
      if (peer.role === 'controller' && lastState) send(peer, { type: 'state', state: lastState });
      return;
    }

    // Per-socket flood guard.
    const now = Date.now();
    peer.msgTimes = peer.msgTimes.filter((t) => now - t < 10_000);
    peer.msgTimes.push(now);
    if (peer.msgTimes.length > MAX_MSGS_PER_10S) return ws.close(4008, 'rate limited');

    if (peer.role === 'controller') onControllerMessage(peer, msg);
    else onDisplayMessage(msg);
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (!peer) return;
    (peer.role === 'display' ? displays : controllers).delete(peer);
    log(`${peer.role} disconnected (${peer.name}); displays=${displays.size}`);
  });
  ws.on('error', () => {});
});

function onControllerMessage(from: Peer, msg: any) {
  if (msg.type !== 'command') return;
  if (typeof msg.id !== 'string' || msg.id.length > 64 || !isCommand(msg.cmd)) {
    return send(from, { type: 'result', id: String(msg.id ?? ''), ok: false, message: 'invalid command' });
  }
  if (displays.size === 0) {
    return send(from, { type: 'result', id: msg.id, ok: false, message: 'No display is connected. Open the display page first.' });
  }
  const cmd: CommandMsg = {
    type: 'command', id: msg.id, cmd: msg.cmd,
    args: msg.args && typeof msg.args === 'object' ? msg.args : {},
  };
  const timer = setTimeout(() => {
    pending.delete(cmd.id);
    send(from, { type: 'result', id: cmd.id, ok: false, message: 'The display did not answer in time.' });
  }, COMMAND_TIMEOUT_MS);
  pending.set(cmd.id, { from, timer });
  log(`-> ${cmd.cmd} ${JSON.stringify(cmd.args)}`);
  for (const d of displays) send(d, cmd);
}

function onDisplayMessage(msg: any) {
  if (msg.type === 'result' && typeof msg.id === 'string') {
    const p = pending.get(msg.id);
    if (!p) return; // a second display answered the same command; the first answer wins
    clearTimeout(p.timer);
    pending.delete(msg.id);
    const result: ResultMsg = {
      type: 'result', id: msg.id, ok: Boolean(msg.ok),
      message: typeof msg.message === 'string' ? msg.message.slice(0, 500) : undefined,
      state: msg.state,
    };
    log(`<- ${result.ok ? 'ok' : 'error'} ${result.message ?? ''}`);
    send(p.from, result);
  } else if (msg.type === 'state') {
    lastState = msg.state;
    for (const c of controllers) send(c, { type: 'state', state: msg.state });
  }
}

function send(p: Peer, msg: unknown) {
  if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(msg));
}

http.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}  (display: http://localhost:${PORT}/display/)`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    log('LAN mode: reachable from other machines on your network; BRIDGE_SECRET is the only gate.');
  }
});
