/* DC Forest tracker sync — Cloudflare Worker.
   - Cron (every 5 min): read the tracking portal server-side, validate, save to KV.
   - GET /live.json: serve the last good snapshot. Everything else: the static site.
   Credentials live only in Worker secrets (PORTAL_USER / PORTAL_PASS); nothing reaches the browser. */

const KEYS = ['total', 'moving', 'idle', 'weakGsm', 'offline', 'noGps'];
const STATES = new Set(['moving', 'idle', 'stop', 'none']);
const SIGNALS = new Set(['strong', 'weak', 'low', 'none']);

/* ---------------------------------------------------------------------------
   SOURCE ADAPTER — deliberately not filled in.
   The portal's login request and the request behind each dashboard number have not
   been observed yet (needs a logged-in network capture). Until they are, this throws,
   so the site keeps showing the last hand-entered numbers marked "Manual update".
   Must return { summary: {total,moving,idle,weakGsm,offline,noGps}, vehicles:[{reg,state,signal}] }
   with null (never 0) for anything the portal did not supply.
--------------------------------------------------------------------------- */
async function fetchFromPortal(env) {
  throw new Error('Source adapter not configured: portal requests not yet mapped');
}

export function validate(s) {
  const errs = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  for (const k of KEYS) {
    const n = s.summary?.[k];
    if (!(n === null || (Number.isInteger(n) && n >= 0))) errs.push(`summary.${k}=${JSON.stringify(n)}`);
  }
  if (!Array.isArray(s.vehicles)) errs.push('vehicles not a list');
  else s.vehicles.forEach((v, i) => {
    if (typeof v?.reg !== 'string' || !/^[A-Z]{2,4}-\d{1,5}$/.test(v.reg)) errs.push(`vehicles[${i}].reg`);
    if (!STATES.has(v?.state)) errs.push(`vehicles[${i}].state=${v?.state}`);
    if (!SIGNALS.has(v?.signal)) errs.push(`vehicles[${i}].signal=${v?.signal}`);
  });
  const t = s.summary?.total;
  if (Number.isInteger(t) && Array.isArray(s.vehicles) && s.vehicles.length > t) errs.push('more vehicles than total');
  return errs;
}

export async function sync(env, adapter = fetchFromPortal) {
  const now = new Date().toISOString();
  const prev = await env.SNAP.get('live', 'json');
  try {
    const data = await adapter(env);
    const errs = validate(data);
    if (errs.length) throw new Error('Validation failed: ' + errs.slice(0, 5).join(', '));
    const snap = { schema: 1, source: 'Vehicle tracking portal', lastSuccessAt: now, lastAttemptAt: now,
                   lastError: null, summary: data.summary, vehicles: data.vehicles };
    await env.SNAP.put('live', JSON.stringify(snap));
    return snap;
  } catch (e) {
    // Keep the last good numbers; only record the failure.
    if (prev) await env.SNAP.put('live', JSON.stringify({ ...prev, lastAttemptAt: now, lastError: String(e.message).slice(0, 200) }));
    console.error('sync failed:', e.message);
    return prev;
  }
}

export default {
  async scheduled(_evt, env, ctx) { ctx.waitUntil(sync(env)); },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/live.json') {
      const body = await env.SNAP.get('live');
      if (!body) return new Response('{"error":"no snapshot yet"}', { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      const s = JSON.parse(body); delete s.lastError;   // keep internal error text off the public page
      return new Response(JSON.stringify(s), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    return env.ASSETS.fetch(req);
  },
};
