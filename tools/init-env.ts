// Creates .env from .env.example with fresh random secrets. Never overwrites an existing .env;
// fills in any secret still set to a change-me placeholder.
//   node tools/init-env.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = root + '.env';
const src = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(root + '.env.example', 'utf8');
let changed = !existsSync(envPath);
const out = src.replace(/^(MCP_AUTH_TOKEN|BRIDGE_SECRET)=(change-me.*)?$/gm, (_m, key) => {
  changed = true;
  return `${key}=${randomBytes(24).toString('base64url')}`;
});
if (changed) {
  writeFileSync(envPath, out);
  console.log('wrote .env with fresh MCP_AUTH_TOKEN and BRIDGE_SECRET');
} else {
  console.log('.env already set up');
}
