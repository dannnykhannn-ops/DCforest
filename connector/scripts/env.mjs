/* Shared by the local scripts: reads PORTAL_TOKEN from connector/.dev.vars and
   provides an in-memory stand-in for the Worker's KV namespace. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readToken() {
  if (process.env.PORTAL_TOKEN) return process.env.PORTAL_TOKEN.trim();
  const file = fileURLToPath(new URL('../.dev.vars', import.meta.url));
  if (!existsSync(file)) return '';
  const m = /^\s*PORTAL_TOKEN\s*=\s*"?([^"\r\n]*)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1].trim() : '';
}

export function memoryKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key, type) { const v = store.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { store.set(key, String(value)); },
  };
}
