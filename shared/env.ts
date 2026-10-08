// Loads the repo-root .env (if present) into process.env. Secrets live only there.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = root + '.env';
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const repoRoot = root;

export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set. Copy .env.example to .env (or run setup-windows.bat).`);
}

export function secretEnv(name: string): string {
  const v = env(name);
  if (v.startsWith('change-me') || v.length < 16) {
    throw new Error(`${name} must be a random value of at least 16 characters (see .env.example).`);
  }
  return v;
}
