/* DC Forest live-fleet connector (Cloudflare Worker).

   Every 5 minutes (cron) : portal feed -> validate -> transform -> KV "live:latest".
   GET /api/live.json     : serves the last successful snapshot plus freshness flags.
   Anything else          : static site, if this Worker is deployed with the site as its assets.

   Secrets (never in the site's code): PORTAL_TOKEN.
   Vars: ALLOWED_ORIGIN (optional, for a site hosted elsewhere), STALE_AFTER_SECONDS. */

import { fetchFleetSnapshot, tokenInfo } from './portal.js';
import { buildSnapshot, validateSnapshot, buildPositions, appendTrail, pkDate, trailKm } from './transform.js';
import * as gate from './gate.js';

const KEY_LATEST = 'live:latest';   // last SUCCESSFUL snapshot; only ever overwritten by another success
const KEY_STATUS = 'live:status';   // last failed attempt; written only on failure
const TRAIL_DAYS = 31;              // trails are kept this many days, then deleted automatically by KV
const trailKey = (date) => 'trail:' + date;

function failureClass(err) {
  const m = /^(auth|network|validation):/.exec(String(err && err.message));
  return m ? m[1] : 'network';
}

export async function sync(env, now = Date.now()) {
  let previous = null;
  try {
    previous = await env.LIVE.get(KEY_LATEST, 'json');
    const token = (env.PORTAL_TOKEN || '').trim();   // a pasted secret often carries a trailing newline
    if (!token) throw new Error('auth: PORTAL_TOKEN secret is not set');
    const info = tokenInfo(token);
    if (info && info.expiresAt && info.expiresAt <= now) throw new Error('auth: portal token has expired');

    const { items, count } = await fetchFleetSnapshot(token);
    validateSnapshot(items, count, previous && previous.summary && previous.summary.total);
    const snapshot = buildSnapshot(items, now);
    snapshot.authExpiresAt = info && info.expiresAt ? new Date(info.expiresAt).toISOString() : null;
    snapshot.positions = buildPositions(items, now);      // owner-only; stripped from /api/live.json

    await env.LIVE.put(KEY_LATEST, JSON.stringify(snapshot));
    await recordTrail(env, snapshot.positions, now);
    console.log('sync ok', JSON.stringify(snapshot.summary));
    return { ok: true, summary: snapshot.summary };
  } catch (err) {
    // The previous good snapshot is deliberately left untouched.
    const status = { lastAttemptAt: new Date(now).toISOString(), lastError: failureClass(err) };
    console.error('sync failed:', err && err.message);
    try { await env.LIVE.put(KEY_STATUS, JSON.stringify(status)); } catch {}
    return { ok: false, error: status.lastError };
  }
}

/* Today's trail: one KV write per sync. A failure here never fails the sync itself. */
async function recordTrail(env, positions, now) {
  try {
    const date = pkDate(now);
    const trail = appendTrail(await env.LIVE.get(trailKey(date), 'json'), positions, date);
    await env.LIVE.put(trailKey(date), JSON.stringify(trail), { expirationTtl: TRAIL_DAYS * 86400 });
  } catch (err) {
    console.error('trail write failed:', err && err.message);
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
}

async function serveLive(request, env) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) };
  const [latest, status] = await Promise.all([env.LIVE.get(KEY_LATEST, 'json'), env.LIVE.get(KEY_STATUS, 'json')]);
  if (!latest) {
    // Nothing has ever succeeded: say so. Never invent an all-zero snapshot.
    return new Response(JSON.stringify({ schema: 1, available: false, lastError: status ? status.lastError : null }), { status: 503, headers });
  }
  const now = Date.now();
  const staleAfter = Number(env.STALE_AFTER_SECONDS) || 900;
  const ageSeconds = Math.max(0, Math.round((now - Date.parse(latest.fetchedAt)) / 1000));
  const failedSince = status && Date.parse(status.lastAttemptAt) > Date.parse(latest.fetchedAt);
  const { authExpiresAt, positions, ...pub } = latest;
  const body = {
    ...pub,
    available: true,
    ageSeconds,
    stale: ageSeconds > staleAfter,
    lastError: failedSince ? status.lastError : null,
    authDaysLeft: authExpiresAt ? Math.floor((Date.parse(authExpiresAt) - now) / 86400000) : null,
  };
  return new Response(JSON.stringify(body), { headers });
}

const noStore = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/* Owner-only: every vehicle's last known position and readings. */
async function serveFleet(env) {
  const [latest, status] = await Promise.all([env.LIVE.get(KEY_LATEST, 'json'), env.LIVE.get(KEY_STATUS, 'json')]);
  if (!latest || !Array.isArray(latest.positions)) {
    return new Response(JSON.stringify({ available: false, lastError: status ? status.lastError : null }), { status: 503, headers: noStore });
  }
  const now = Date.now();
  const ageSeconds = Math.max(0, Math.round((now - Date.parse(latest.fetchedAt)) / 1000));
  const failedSince = status && Date.parse(status.lastAttemptAt) > Date.parse(latest.fetchedAt);
  return new Response(JSON.stringify({
    available: true, fetchedAt: latest.fetchedAt, ageSeconds,
    stale: ageSeconds > (Number(env.STALE_AFTER_SECONDS) || 900),
    lastError: failedSince ? status.lastError : null,
    summary: latest.summary, vehicles: latest.positions, demo: latest.demo === true || undefined,
  }), { headers: noStore });
}

/* Owner-only: one day's trail (Pakistan date), all vehicles or one, with km per vehicle. */
async function serveTrail(env, url) {
  const date = url.searchParams.get('date') || pkDate(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response(JSON.stringify({ error: 'bad date' }), { status: 400, headers: noStore });
  const reg = url.searchParams.get('reg');
  const trail = (await env.LIVE.get(trailKey(date), 'json')) || { date, v: {} };
  const v = reg ? (trail.v[reg] ? { [reg]: trail.v[reg] } : {}) : trail.v;
  const km = Object.fromEntries(Object.entries(v).map(([r, pts]) => [r, trailKm(pts)]));
  return new Response(JSON.stringify({ date, keptDays: TRAIL_DAYS, vehicles: v, km }), { headers: noStore });
}

/* Fetch control.html from the static files. Cloudflare's asset handling redirects "/control.html" to
   "/control" (and may do the reverse), so a redirect is followed here on the server and never handed to the
   browser, where it would loop back into this route. */
async function controlPage(env, url) {
  let target = new URL('/control', url);
  for (let hop = 0; hop < 3; hop++) {
    const res = await env.ASSETS.fetch(new Request(target, { method: 'GET', redirect: 'manual' }));
    if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
      target = new URL(res.headers.get('Location'), target);
      if (target.origin !== url.origin) break;
      continue;
    }
    if (res.status === 404 && hop === 0) { target = new URL('/control.html', url); continue; }
    return res;
  }
  return new Response('Control Room page not found', { status: 502 });
}

const OWNER_PAGES = /^\/control(\.html)?\/?$/;
const OWNER_APIS = /^\/api\/(fleet|trail)\.json$/;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sync(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);

    // Access gate: the entry page and its API first, then everything except images/icons needs a session.
    const gateResponse = await gate.route(request, env, url);
    if (gateResponse) return gateResponse;

    // Control Room: owner session required, even when the main site is open to everyone.
    if (OWNER_PAGES.test(url.pathname) || OWNER_APIS.test(url.pathname)) {
      if (!(await gate.isOwner(request, env))) {
        return OWNER_APIS.test(url.pathname)
          ? new Response(JSON.stringify({ error: 'owner-only' }), { status: 403, headers: noStore })
          : gate.ownerPage();
      }
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (url.pathname === '/api/fleet.json') return serveFleet(env);
      if (url.pathname === '/api/trail.json') return serveTrail(env, url);
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      const res = await controlPage(env, url);
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-store'); headers.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(res.body, { status: res.status, headers });
    }
    if (!gate.isPublic(url.pathname)) {
      const denied = await gate.guard(request, env, url.pathname);
      if (denied) return denied;
    }

    if (url.pathname === '/api/live.json') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), 'Access-Control-Allow-Methods': 'GET' } });
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return serveLive(request, env);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
