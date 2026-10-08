// Browser side of the voice fallback. Bundled by server.ts with esbuild.
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents-realtime';

const $ = (id) => document.getElementById(id);
const say = (text, cls = '') => {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  $('log').prepend(p);
};

// MCP input schemas are full JSON Schema documents; a function tool wants the plain object part.
function functionSchema(s = {}) {
  const { $schema, ...rest } = s;
  return { type: 'object', properties: {}, additionalProperties: false, ...rest };
}

// Every MCP tool becomes a function tool whose execute() goes back through the local server.
async function loadTools() {
  const r = await fetch('/tools');
  const list = await r.json();
  if (!r.ok) throw new Error(list.error || 'could not list MCP tools');
  return list.map((t) => tool({
    name: t.name,
    description: t.description || t.name,
    parameters: functionSchema(t.inputSchema),
    strict: false,
    execute: async (args) => {
      say(`→ ${t.name} ${JSON.stringify(args)}`, 'tool');
      const res = await fetch(`/tools/${encodeURIComponent(t.name)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}),
      });
      const out = await res.json();
      say(`${out.isError ? '✗' : '✓'} ${out.text || out.error}`, out.isError ? 'err' : 'ok');
      return out.text || out.error;
    },
  }));
}

let session = null;

async function start() {
  $('start').disabled = true;
  try {
    const tools = await loadTools();
    say(`${tools.length} tools from the MCP server: ${tools.map((t) => t.name).join(', ')}`);
    const r = await fetch('/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const s = await r.json();
    if (!r.ok) throw new Error(s.error);
    const agent = new RealtimeAgent({
      name: 'Display assistant',
      instructions: 'You control a glasses-free 3D display. When the user asks to see something, call list_assets if you do not know the names, then show_model or show_splat. Use set_mode for 2D/3D, start_call for a video call, clear to empty the display. Confirm in one short sentence.',
      tools,
    });
    session = new RealtimeSession(agent, { model: s.model, config: { audio: { output: { voice: s.voice } } } });
    session.on('error', (e) => say(`error: ${e?.error?.message || e?.message || JSON.stringify(e)}`, 'err'));
    await session.connect({ apiKey: s.value });
    say('Connected. Try: "show me the astronaut", "switch to 2D", "show the planet".', 'ok');
    $('stop').disabled = false;
  } catch (e) {
    say(`could not start: ${e.message}`, 'err');
    $('start').disabled = false;
  }
}

function stop() {
  session?.close();
  session = null;
  $('stop').disabled = true;
  $('start').disabled = false;
  say('Disconnected.');
}

$('start').onclick = start;
$('stop').onclick = stop;

// Tool check without a key: lists tools so the MCP path can be verified on its own.
fetch('/tools').then((r) => r.json()).then(
  (list) => { $('tools').textContent = Array.isArray(list) ? list.map((t) => t.name).join(' · ') : list.error; },
  (e) => { $('tools').textContent = e.message; },
);
