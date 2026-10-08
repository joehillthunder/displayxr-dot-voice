// Starts a real bridge on a spare port and checks auth and routing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const PORT = 18787;
const SECRET = 'test-secret-0123456789abcdef';
let proc: ChildProcess;

before(async () => {
  proc = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.ts', import.meta.url))], {
    env: { ...process.env, BRIDGE_PORT: String(PORT), BRIDGE_SECRET: SECRET, BRIDGE_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => proc.stdout!.on('data', (d) => String(d).includes('listening') && resolve()));
});
after(() => { proc.kill(); });

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
const next = (ws: WebSocket) => new Promise<any>((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
const closed = (ws: WebSocket) => new Promise<number>((r) => ws.once('close', (code) => r(code)));

async function hello(role: 'display' | 'controller', secret = SECRET) {
  const ws = await open();
  ws.send(JSON.stringify({ type: 'hello', v: 1, role, secret }));
  return ws;
}

test('rejects a wrong secret', async () => {
  const ws = await hello('controller', 'wrong-secret-0123456789');
  assert.equal(await closed(ws), 4003);
});

test('rejects a command before hello', async () => {
  const ws = await open();
  ws.send(JSON.stringify({ type: 'command', id: '1', cmd: 'clear', args: {} }));
  assert.equal(await closed(ws), 4003);
});

test('reports no display, then routes a command and its result', async () => {
  const ctl = await hello('controller');
  assert.equal((await next(ctl)).type, 'welcome');
  ctl.send(JSON.stringify({ type: 'command', id: 'a', cmd: 'clear', args: {} }));
  const none = await next(ctl);
  assert.equal(none.ok, false);
  assert.match(none.message, /No display/);

  const disp = await hello('display');
  assert.equal((await next(disp)).type, 'welcome');
  ctl.send(JSON.stringify({ type: 'command', id: 'b', cmd: 'show_model', args: { name: 'apple' } }));
  const cmd = await next(disp);
  assert.deepEqual([cmd.cmd, cmd.args.name], ['show_model', 'apple']);
  disp.send(JSON.stringify({ type: 'result', id: 'b', ok: true, message: 'showing apple' }));
  const res = await next(ctl);
  assert.deepEqual([res.id, res.ok, res.message], ['b', true, 'showing apple']);

  ctl.send(JSON.stringify({ type: 'command', id: 'c', cmd: 'rm_rf', args: {} }));
  assert.equal((await next(ctl)).message, 'invalid command');
  ctl.close();
  disp.close();
});

test('serves the display but not files outside it', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/display/`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/assets/catalog.json`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/assets/..%2f.env`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/assets/..%2fpackage.json`)).status, 404);
});
