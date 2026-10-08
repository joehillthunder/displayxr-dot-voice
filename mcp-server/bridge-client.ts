// A controller connection to the bridge, with reconnect. send() resolves with the display's result.
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type Command, type DisplayState, type ResultMsg } from '../shared/protocol.ts';

export class BridgeClient {
  #ws: WebSocket | null = null;
  #ready = false;
  #pending = new Map<string, (r: ResultMsg) => void>();
  state: DisplayState | null = null;
  readonly url: string;
  readonly secret: string;

  constructor(url: string, secret: string) {
    this.url = url;
    this.secret = secret;
    this.#connect();
  }

  get connected() { return this.#ready; }

  #connect() {
    const ws = new WebSocket(this.url);
    this.#ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, role: 'controller', secret: this.secret, name: 'mcp-server' })));
    ws.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'welcome') { this.#ready = true; console.log('[mcp] connected to bridge', this.url); }
      else if (msg.type === 'state') this.state = msg.state;
      else if (msg.type === 'result') {
        if (msg.state) this.state = msg.state;
        this.#pending.get(msg.id)?.(msg);
        this.#pending.delete(msg.id);
      }
    });
    ws.on('close', (code, reason) => {
      if (this.#ready) console.log('[mcp] bridge connection closed', code, reason.toString());
      this.#ready = false;
      for (const [id, done] of this.#pending) done({ type: 'result', id, ok: false, message: 'Lost the connection to the bridge.' });
      this.#pending.clear();
      setTimeout(() => this.#connect(), 2000);
    });
    ws.on('error', () => {});
  }

  send(cmd: Command, args: Record<string, unknown>): Promise<ResultMsg> {
    const id = randomUUID();
    if (!this.#ready || !this.#ws) {
      return Promise.resolve({ type: 'result', id, ok: false, message: 'The display bridge is not running or not reachable.' });
    }
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#ws!.send(JSON.stringify({ type: 'command', id, cmd, args }));
    });
  }
}
