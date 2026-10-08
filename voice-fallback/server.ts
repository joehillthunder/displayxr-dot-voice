// Voice fallback: talk to a Realtime voice agent in the browser, and its tool calls go to the same
// MCP server dots/ChatGPT would use. Use it when your dot can't reach a custom MCP plugin.
//
// The browser holds only a short-lived ephemeral key. This local server holds OPENAI_API_KEY and
// MCP_AUTH_TOKEN, mints the ephemeral key, and proxies tool calls to the MCP server as an MCP
// client. The tool list comes from the MCP server, so nothing here is display-specific.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { env, secretEnv } from '../shared/env.ts';

const PORT = Number(env('VOICE_PORT', '8791'));
const ORIGIN = `http://localhost:${PORT}`;
const MODEL = env('OPENAI_REALTIME_MODEL', 'gpt-realtime-2.1');
const VOICE = env('OPENAI_REALTIME_VOICE', 'marin');
const MCP_URL = new URL(env('MCP_URL', `http://127.0.0.1:${env('MCP_PORT', '8790')}/mcp`));
const token = secretEnv('MCP_AUTH_TOKEN');
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// ── MCP client (reconnects lazily) ─────────────────────────────────────────────────────────
let client: Client | null = null;
async function mcp(): Promise<Client> {
  if (client) return client;
  const c = new Client({ name: 'dxr-voice-fallback', version: '0.1.0' });
  await c.connect(new StreamableHTTPClientTransport(MCP_URL, { authProvider: { token: async () => token } }));
  client = c;
  return c;
}

// ── browser bundle ──────────────────────────────────────────────────────────────────────────
const bundle = await build({
  entryPoints: [here('./client.js')], bundle: true, format: 'esm', write: false,
  platform: 'browser', target: 'es2022', minify: true, logLevel: 'warning',
});
const clientJs = bundle.outputFiles[0].text;
const indexHtml = readFileSync(here('./index.html'), 'utf8');

// ── http ────────────────────────────────────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', ORIGIN);
  // Local only: refuse other Host headers (DNS rebinding) and cross-site POSTs (CSRF).
  const host = (req.headers.host || '').split(':')[0];
  if (host !== 'localhost' && host !== '127.0.0.1') return json(res, 403, { error: 'host not allowed' });
  if (req.method === 'POST' && req.headers.origin !== ORIGIN && req.headers.origin !== `http://127.0.0.1:${PORT}`) {
    return json(res, 403, { error: 'origin not allowed' });
  }
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(indexHtml);
    } else if (req.method === 'GET' && url.pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(clientJs);
    } else if (req.method === 'GET' && url.pathname === '/tools') {
      const { tools } = await (await mcp()).listTools();
      json(res, 200, tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
    } else if (req.method === 'POST' && url.pathname.startsWith('/tools/')) {
      const name = decodeURIComponent(url.pathname.slice('/tools/'.length));
      const args = await readJson(req);
      const r = await (await mcp()).callTool({ name, arguments: args && typeof args === 'object' ? args : {} });
      const text = (r.content as { type: string; text?: string }[] | undefined)?.map((c) => c.text ?? '').join('\n') ?? '';
      console.log(`[voice] ${name}(${JSON.stringify(args)}) -> ${r.isError ? 'error' : 'ok'}: ${text}`);
      json(res, 200, { text, isError: !!r.isError });
    } else if (req.method === 'POST' && url.pathname === '/session') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return json(res, 400, { error: 'OPENAI_API_KEY is not set in .env. The mock CLI works without one.' });
      const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ session: { type: 'realtime', model: MODEL } }),
      });
      const body: any = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, r.status, { error: body?.error?.message || `OpenAI returned ${r.status}` });
      json(res, 200, { value: body.value, model: MODEL, voice: VOICE });
    } else {
      json(res, 404, { error: 'not found' });
    }
  } catch (e) {
    client = null; // reconnect next time
    json(res, 502, { error: (e as Error).message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[voice] open ${ORIGIN}  (MCP ${MCP_URL.href}, model ${MODEL})`);
});
