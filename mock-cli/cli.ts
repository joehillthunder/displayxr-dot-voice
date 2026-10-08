// Mock command source: an MCP client that stands in for dots/ChatGPT/voice, so the whole path
// (MCP server → bridge → display) runs with no OpenAI account.
//
//   npm run mock                      interactive prompt
//   npm run mock -- model astronaut   one command, then exit
//   npm run mock -- demo              scripted tour of every tool
import { createInterface } from 'node:readline/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { env, secretEnv } from '../shared/env.ts';

const url = new URL(env('MCP_URL', `http://127.0.0.1:${env('MCP_PORT', '8790')}/mcp`));
const token = secretEnv('MCP_AUTH_TOKEN');

const client = new Client({ name: 'dxr-mock-cli', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(url, { authProvider: { token: async () => token } }));

const HELP = `commands:
  list                  list_assets
  model <name|url>      show_model
  splat <name|url>      show_splat
  mode 2d|3d            set_mode
  call                  start_call
  clear                 clear
  tools                 list the server's tools
  demo                  run every tool in turn
  quit`;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const out = (r.content as { type: string; text?: string }[] | undefined)?.map((c) => c.text ?? '').join('\n') ?? '';
  console.log(`${r.isError ? 'ERROR' : 'ok'}  ${name}(${JSON.stringify(args)})\n${out}\n`);
  return !r.isError;
}

const asset = (v: string) => (/^https?:/i.test(v) ? { url: v } : { name: v });

async function run(line: string): Promise<boolean> {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ');
  switch ((cmd || '').toLowerCase()) {
    case '': return true;
    case 'list': return call('list_assets');
    case 'model': return call('show_model', asset(arg));
    case 'splat': return call('show_splat', asset(arg));
    case 'mode': return call('set_mode', { mode: arg.toLowerCase() });
    case 'call': return call('start_call');
    case 'clear': return call('clear');
    case 'tools': {
      const { tools } = await client.listTools();
      for (const t of tools) console.log(`${t.name}: ${t.description}`);
      return true;
    }
    case 'demo': {
      const steps = ['list', 'model astronaut', 'model ambulance', 'splat planet', 'mode 2d', 'mode 3d', 'model avocado', 'clear'];
      let ok = true;
      for (const s of steps) {
        console.log(`> ${s}`);
        ok = (await run(s)) && ok;
        await new Promise((r) => setTimeout(r, 2500));
      }
      return ok;
    }
    case 'help': console.log(HELP); return true;
    default: console.log(`unknown command "${cmd}"\n${HELP}`); return false;
  }
}

const argv = process.argv.slice(2);
if (argv.length) {
  const ok = await run(argv.join(' '));
  await client.close();
  // Not process.exit(): on Windows that can abort while fetch sockets are still closing.
  process.exitCode = ok ? 0 : 1;
} else {
  await repl();
}

async function repl() {
  console.log(`connected to ${url.href}\n${HELP}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const line = await rl.question('dxr> ');
    if (/^(quit|exit)$/i.test(line.trim())) break;
    try { await run(line); } catch (e) { console.log('error:', (e as Error).message); }
  }
  rl.close();
  await client.close();
}
