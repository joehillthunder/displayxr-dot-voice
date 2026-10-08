// The display tools. Agent-neutral: nothing here knows which MCP client (ChatGPT/dots, Claude,
// the voice fallback, the mock CLI) is calling. No filesystem or shell access is reachable from a
// tool: they only read the in-memory catalog and forward a validated command to the bridge.
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { checkAssetUrl, type AssetKind, type CatalogEntry } from '../shared/assets.ts';
import type { Command, ResultMsg } from '../shared/protocol.ts';

export interface ToolDeps {
  catalog: CatalogEntry[];
  allowlist: string[];
  send: (cmd: Command, args: Record<string, unknown>) => Promise<ResultMsg>;
  /** Returns false when the caller is over the rate limit. */
  take: () => boolean;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });
const RATE_LIMITED = text('Rate limit reached for display commands. Wait a few seconds and try again.', true);

const assetInput = {
  name: z.string().max(64).optional().describe('A catalog name from list_assets, e.g. "astronaut".'),
  url: z.string().max(2048).optional().describe('An https URL on the operator allowlist. Prefer name.'),
};

export function registerTools(server: McpServer, deps: ToolDeps) {
  const { catalog, allowlist, send, take } = deps;

  const relay = async (cmd: Command, args: Record<string, unknown>, okText: (r: ResultMsg) => string) => {
    if (!take()) return RATE_LIMITED;
    const r = await send(cmd, args);
    return r.ok ? text(okText(r)) : text(r.message || 'The display reported an error.', true);
  };

  const showAsset = (kind: AssetKind, cmd: Command) => async ({ name, url }: { name?: string; url?: string }) => {
    if (!!name === !!url) return text('Pass exactly one of name or url.', true);
    let args: Record<string, unknown>;
    let label: string;
    if (name) {
      const entry = catalog.find((a) => a.name === name.toLowerCase().trim());
      if (!entry) return text(`No asset named "${name}". Available: ${catalog.map((a) => a.name).join(', ')}.`, true);
      if (entry.kind !== kind) return text(`"${entry.name}" is a ${entry.kind}; use show_${entry.kind}.`, true);
      args = { name: entry.name };
      label = entry.name;
    } else {
      try { args = { url: checkAssetUrl(url!, kind, allowlist) }; } catch (e) { return text((e as Error).message, true); }
      label = String(args.url);
    }
    return relay(cmd, args, (r) => `Showing ${label} on the display${r.state?.woven ? ' in glasses-free 3D' : ' (2D view; no 3D display detected)'}.`);
  };

  server.registerTool('list_assets', {
    title: 'List display assets',
    description: 'List the 3D models and Gaussian splats that can be shown on the 3D display, with licenses.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  }, async () => text(catalog.map((a) => `${a.name} (${a.kind}): ${a.description}. License ${a.license}, ${a.source}.`).join('\n')));

  server.registerTool('show_model', {
    title: 'Show 3D model',
    description: 'Show a glTF/GLB 3D model on the glasses-free 3D display (2D in an ordinary browser). Replaces what is showing.',
    inputSchema: z.object(assetInput),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  }, showAsset('model', 'show_model'));

  server.registerTool('show_splat', {
    title: 'Show Gaussian splat',
    description: 'Show a 3D Gaussian splat (.ply or .sog) on the 3D display. Replaces what is showing.',
    inputSchema: z.object(assetInput),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  }, showAsset('splat', 'show_splat'));

  server.registerTool('set_mode', {
    title: 'Set 2D or 3D',
    description: 'Switch the display between glasses-free 3D and flat 2D.',
    inputSchema: z.object({ mode: z.enum(['2d', '3d']) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  }, async ({ mode }) => relay('set_mode', { mode }, (r) =>
    r.state?.woven ? `Display set to ${mode.toUpperCase()}.` : `Recorded ${mode.toUpperCase()}, but no 3D display is attached, so the view stays 2D.`));

  server.registerTool('start_call', {
    title: 'Open 3D video call',
    description: 'Open the 3D video call lobby on the display. The camera and microphone only start after a person at the display clicks to join. Returns the invite link when available.',
    inputSchema: z.object({}),
    // openWorld: a joined call talks to the DisplayXR signalling service and to peers.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  }, async () => relay('start_call', {}, (r) =>
    'The call lobby is open on the display; someone there must click to join.' + (r.state?.invite ? ` Invite link: ${r.state.invite}` : '')));

  server.registerTool('clear', {
    title: 'Clear display',
    description: 'Remove whatever is showing on the 3D display (also leaves any call).',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  }, async () => relay('clear', {}, () => 'Display cleared.'));
}
