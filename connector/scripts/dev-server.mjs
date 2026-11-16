/* Local preview: the website plus /api/live.json on http://localhost:8787, using the real Worker code.
     node scripts/dev-server.mjs                 real portal data (token from .dev.vars), re-synced every 5 min
     node scripts/dev-server.mjs --seed f.json   serve a saved snapshot instead (no token needed)
     add --fail to simulate the portal being unreachable after the first snapshot */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { sync } from '../src/worker.js';
import { memoryKV, readToken } from './env.mjs';

const args = process.argv.slice(2);
const seedFile = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : null;
const simulateFail = args.includes('--fail');
const PORT = Number(process.env.PORT) || 8787;
const SITE = resolve(fileURLToPath(new URL('../../site-v19-extracted/forest-tracker-site', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };

// The access gate is switched off for this local preview (it only ever listens on this computer).
const env = { LIVE: memoryKV({ 'gate:config': '{"open":true}' }), STALE_AFTER_SECONDS: process.env.STALE_AFTER_SECONDS || '900', ALLOWED_ORIGIN: '' };
if (seedFile) {
  await env.LIVE.put('live:latest', readFileSync(seedFile, 'utf8'));
  console.log('Serving saved snapshot from', seedFile);
  if (simulateFail) await sync(env);            // no token => a recorded failed attempt on top of the saved snapshot
} else {
  env.PORTAL_TOKEN = readToken();
  const run = async () => console.log(new Date().toLocaleTimeString(), 'sync ->', JSON.stringify(await sync(env)));
  await run();
  if (simulateFail) env.PORTAL_TOKEN = '';
  setInterval(run, 5 * 60 * 1000);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  if (url.pathname.startsWith('/api/')) {
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  const file = join(SITE, rel);
  if (file !== SITE && !file.startsWith(SITE + sep)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(PORT, () => console.log('Preview on http://localhost:' + PORT));
