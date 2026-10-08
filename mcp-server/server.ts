// Remote MCP server (Streamable HTTP at /mcp) that puts 3D content on a DisplayXR display.
// Any MCP client can use it: ChatGPT / dots (custom plugin), Claude, the voice fallback, the
// mock CLI. Auth: a static bearer token (MCP_AUTH_TOKEN). See docs/security.md.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp, requireBearerAuth, type OAuthTokenVerifier } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';
import { env, secretEnv } from '../shared/env.ts';
import { loadCatalog, parseAllowlist } from '../shared/assets.ts';
import { BridgeClient } from './bridge-client.ts';
import { registerTools } from './tools.ts';
import { tokenBucket } from './rate-limit.ts';

const PORT = Number(env('MCP_PORT', '8790'));
const HOST = env('MCP_HOST', '127.0.0.1');
const TOKEN_HASH = sha(secretEnv('MCP_AUTH_TOKEN'));
const BRIDGE_URL = env('BRIDGE_URL', `ws://127.0.0.1:${env('BRIDGE_PORT', '8787')}/ws`);
// Hostnames a tunnel forwards with (e.g. dxr.example.com). Everything else is refused, which
// also blocks DNS-rebinding against the local port.
const PUBLIC_HOSTS = env('MCP_PUBLIC_HOSTS', '').split(',').map((s) => s.trim()).filter(Boolean);

function sha(s: string) { return createHash('sha256').update(s).digest(); }

const catalog = loadCatalog();
const allowlist = parseAllowlist(process.env.ASSET_URL_ALLOWLIST);
const bridge = new BridgeClient(BRIDGE_URL, secretEnv('BRIDGE_SECRET'));
const take = tokenBucket(Number(env('MCP_RATE_PER_MIN', '20')), Number(env('MCP_RATE_BURST', '5')));

const handler = createMcpHandler(() => {
  const server = new McpServer(
    { name: 'displayxr-dot-voice', version: '0.1.0' },
    { instructions: 'Controls a glasses-free 3D display. Call list_assets to see what can be shown, then show_model or show_splat by name. Keep replies short; the user is looking at the display.' },
  );
  registerTools(server, { catalog, allowlist, send: (c, a) => bridge.send(c, a), take });
  return server;
}, { onerror: (e) => console.error('[mcp]', e.message) });

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token): Promise<AuthInfo> {
    if (!timingSafeEqual(sha(token), TOKEN_HASH)) throw new OAuthError(OAuthErrorCode.InvalidToken, 'unknown token');
    // The SDK requires an expiry. A static token is checked on every request, so report a
    // rolling hour; rotate MCP_AUTH_TOKEN in .env to revoke it.
    return { token, clientId: 'static-token', scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  },
};

const app = createMcpExpressApp({ host: HOST, allowedHosts: ['localhost', '127.0.0.1', ...PUBLIC_HOSTS] });
const node = toNodeHandler(handler);
app.get('/healthz', (_req, res) => { res.json({ ok: true, bridge: bridge.connected, display: bridge.state }); });
app.all('/mcp', requireBearerAuth({ verifier }), (req, res) => void node(req, res, req.body));

app.listen(PORT, HOST, () => {
  console.log(`[mcp] listening on http://${HOST}:${PORT}/mcp  (bridge ${BRIDGE_URL})`);
  if (PUBLIC_HOSTS.length) console.log('[mcp] accepting tunnel hosts:', PUBLIC_HOSTS.join(', '));
});
