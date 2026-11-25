/* Local preview: the website plus /api/live.json on http://localhost:8787, using the real Worker code.
     node scripts/dev-server.mjs                 real portal data (token from .dev.vars), re-synced every 5 min
     node scripts/dev-server.mjs --seed f.json   serve a saved snapshot instead (no token needed)
     node scripts/dev-server.mjs --demo          made-up positions and trails (Control Room preview, no token needed)
     add --fail to simulate the portal being unreachable after the first snapshot
   The Control Room (/control) needs the owner PIN: DEV_ADMIN_PIN, default 0000 (this computer only). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { sync } from '../src/worker.js';
import { randomBytes } from 'node:crypto';
import { memoryKV, readToken } from './env.mjs';
import { seedDemo } from './demo-data.mjs';

const args = process.argv.slice(2);
const seedFile = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : null;
const simulateFail = args.includes('--fail');
const demo = args.includes('--demo');
const PORT = Number(process.env.PORT) || 8787;
const SITE = resolve(fileURLToPath(new URL('../../site-v19-extracted/forest-tracker-site', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };

// The access gate is switched off for this local preview (it only ever listens on this computer).
const env = { LIVE: memoryKV({ 'gate:config': '{"open":true}' }), STALE_AFTER_SECONDS: process.env.STALE_AFTER_SECONDS || '900', ALLOWED_ORIGIN: '',
  ADMIN_PIN: process.env.DEV_ADMIN_PIN || '0000', SESSION_SECRET: randomBytes(24).toString('hex') };
if (demo) {
  const html = readFileSync(join(SITE, 'index.html'), 'utf8');
  const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const regs = data.fleet || [];
  const reseed = () => seedDemo(env, regs).then(() => console.log(new Date().toLocaleTimeString(), 'demo data refreshed'));
  await reseed();
  setInterval(reseed, 60 * 1000);
} else if (seedFile) {
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

env.ASSETS = { async fetch(request) {
  const p = new URL(request.url).pathname;
  const rel = normalize(decodeURIComponent(p === '/' ? '/index.html' : p));
  const file = join(SITE, rel);
  if (file !== SITE && !file.startsWith(SITE + sep)) return new Response('Forbidden', { status: 403 });
  try {
    return new Response(await readFile(file), { headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
  } catch { return new Response('Not found', { status: 404 }); }
} };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  const headers = Object.fromEntries(r.headers);
  const cookie = r.headers.get('Set-Cookie');
  if (cookie) headers['set-cookie'] = cookie.replace(/; Secure/, '');   // plain http on this computer
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log('Preview on http://localhost:' + PORT));
