// The asset catalog (assets/catalog.json) and the URL allowlist. The MCP server is the gate:
// a tool can only show a catalog name, or an https URL under an allowlisted prefix with the
// right file extension. The display re-checks the extension and scheme (defense in depth).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './env.ts';

export type AssetKind = 'model' | 'splat';
export interface CatalogEntry {
  name: string;
  kind: AssetKind;
  /** Relative to assets/ (served by the bridge and by GitHub Pages). */
  path?: string;
  /** Absolute URL for a remote asset (must itself be allowlisted). */
  url?: string;
  description: string;
  license: string;
  source: string;
}

export const EXTENSIONS: Record<AssetKind, string[]> = {
  model: ['.glb', '.gltf'],
  splat: ['.ply', '.sog'],
};

/** Pinned prefixes only. Add your own CDN with ASSET_URL_ALLOWLIST (comma-separated). */
export const DEFAULT_ALLOWLIST = [
  'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@edc7c9e67c639d230715049ee31f9a96a6babbbe/',
];

export function loadCatalog(): CatalogEntry[] {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'assets', 'catalog.json'), 'utf8'));
  return raw.assets as CatalogEntry[];
}

export function parseAllowlist(value: string | undefined): string[] {
  const extra = (value || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWLIST, ...extra];
}

/** Returns the normalized URL if allowed, or throws with a reason the agent can read. */
export function checkAssetUrl(input: string, kind: AssetKind, allowlist: string[]): string {
  let u: URL;
  try { u = new URL(input); } catch { throw new Error('Not a valid URL.'); }
  if (u.protocol !== 'https:') throw new Error('Only https URLs are allowed.');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.');
  const path = u.pathname.toLowerCase();
  if (!EXTENSIONS[kind].some((ext) => path.endsWith(ext))) {
    throw new Error(`A ${kind} URL must end in ${EXTENSIONS[kind].join(' or ')}.`);
  }
  const ok = allowlist.some((prefix) => {
    let p: URL;
    try { p = new URL(prefix); } catch { return false; }
    return p.origin === u.origin && u.pathname.startsWith(p.pathname);
  });
  if (!ok) throw new Error('That URL is not on the asset allowlist. Use list_assets for names, or ask the operator to allowlist the host.');
  return u.href;
}
