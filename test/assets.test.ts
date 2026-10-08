import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssetUrl, parseAllowlist, loadCatalog, DEFAULT_ALLOWLIST } from '../shared/assets.ts';
import { tokenBucket } from '../mcp-server/rate-limit.ts';

const allow = parseAllowlist('https://assets.example.com/dxr/');
const KHRONOS = DEFAULT_ALLOWLIST[0] + 'Models/Avocado/glTF-Binary/Avocado.glb';

test('allows pinned and configured prefixes', () => {
  assert.equal(checkAssetUrl(KHRONOS, 'model', allow), KHRONOS);
  assert.ok(checkAssetUrl('https://assets.example.com/dxr/a/b.ply', 'splat', allow));
});

test('rejects everything else', () => {
  const bad: [string, 'model' | 'splat'][] = [
    ['http://assets.example.com/dxr/x.glb', 'model'],            // not https
    ['https://assets.example.com/other/x.glb', 'model'],         // outside the prefix
    ['https://assets.example.com.evil.io/dxr/x.glb', 'model'],   // look-alike host
    ['https://assets.example.com@evil.io/dxr/x.glb', 'model'],   // credentials trick
    ['https://u:p@assets.example.com/dxr/x.glb', 'model'],       // credentials
    ['https://assets.example.com/dxr/x.exe', 'model'],           // wrong type
    ['https://assets.example.com/dxr/x.glb', 'splat'],           // wrong kind
    ['file:///C:/Windows/win.ini', 'model'],
    ['javascript:alert(1)//.glb', 'model'],
    ['not a url', 'model'],
  ];
  for (const [url, kind] of bad) assert.throws(() => checkAssetUrl(url, kind, allow), Error, url);
});

test('catalog entries are well formed and remote ones are allowlisted', () => {
  const names = new Set<string>();
  for (const a of loadCatalog()) {
    assert.ok(!names.has(a.name), `duplicate ${a.name}`);
    names.add(a.name);
    assert.ok(a.license && a.source, `${a.name} needs license and source`);
    assert.ok(!!a.path !== !!a.url, `${a.name} needs exactly one of path/url`);
    if (a.url) checkAssetUrl(a.url, a.kind, parseAllowlist(''));
  }
});

test('token bucket allows a burst, then refills', () => {
  let now = 0;
  const take = tokenBucket(60, 3, () => now);
  assert.deepEqual([take(), take(), take(), take()], [true, true, true, false]);
  now += 1000; // 60/min = 1 per second
  assert.equal(take(), true);
  assert.equal(take(), false);
});
