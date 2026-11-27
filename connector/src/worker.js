/* DC Forest live-fleet connector (Cloudflare Worker).

   Every 5 minutes (cron) : portal feed -> validate -> transform -> KV "live:latest".
   GET /api/live.json     : serves the last successful snapshot plus freshness flags.
   Anything else          : static site, if this Worker is deployed with the site as its assets.

   Secrets (never in the site's code): PORTAL_TOKEN.
   Vars: ALLOWED_ORIGIN (optional, for a site hosted elsewhere), STALE_AFTER_SECONDS. */

import { fetchFleetSnapshot, tokenInfo } from './portal.js';
import { buildSnapshot, validateSnapshot, buildPositions, appendTrail, pkDate, trailKm, summarizeDay, dateRange } from './transform.js';
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
    authDaysLeft: latest.authExpiresAt ? Math.floor((Date.parse(latest.authExpiresAt) - now) / 86400000) : null,
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

/* Fetch an owner page (control.html, dashboard.html) from the static files. Cloudflare's asset handling redirects "/control.html" to
   "/control" (and may do the reverse), so a redirect is followed here on the server and never handed to the
   browser, where it would loop back into this route. */
async function ownerPage(env, url, name) {
  let target = new URL('/' + name, url);
  for (let hop = 0; hop < 3; hop++) {
    const res = await env.ASSETS.fetch(new Request(target, { method: 'GET', redirect: 'manual' }));
    if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
      target = new URL(res.headers.get('Location'), target);
      if (target.origin !== url.origin) break;
      continue;
    }
    if (res.status === 404 && hop === 0) { target = new URL('/' + name + '.html', url); continue; }
    return res;
  }
  return new Response('Owner page not found', { status: 502 });
}

/* Marks a page with the site design (html data-skin="classic" | "new") so it renders in that look from
   the first paint, and stops it being cached. */
async function themed(res, theme) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store'); headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (!res.ok || !(headers.get('Content-Type') || '').includes('text/html')) return new Response(res.body, { status: res.status, headers });
  const html = (await res.text()).replace(/<html\b([^>]*)>/i, (m, a) => '<html' + a.replace(/\sdata-skin="[^"]*"/, '') + ' data-skin="' + theme + '">');
  headers.delete('Content-Length'); headers.delete('ETag');
  return new Response(html, { status: res.status, headers });
}

/* The classic page; for the owner, with the owner tools script added (owner bar, alerts, activity, reports). */
async function classicPage(env, url, owner) {
  const res = await themed(await env.ASSETS.fetch(new Request(new URL('/', url), { method: 'GET' })), 'classic');
  if (!owner || !res.ok) return res;
  return withScripts(res, ['owner-tools.js', 'notes.js']);
}
async function withScripts(res, srcs) {
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('text/html')) return res;
  const tags = srcs.map((s) => '<script src="' + s + '" defer></script>').join('');
  return new Response((await res.text()).replace(/<\/body>/i, tags + '</body>'), { status: res.status, headers: res.headers });
}

/* Notes left by the owner and reviewers, pinned to a spot on a page. Owner and reviewers all see every
   note; the owner can mark notes done or delete any; a reviewer can delete their own. KV key "notes". */
const NOTES_KEY = 'notes', NOTES_MAX = 500;
async function serveNotes(request, env, who) {
  const notes = (await env.LIVE.get(NOTES_KEY, 'json')) || [];
  const reply = (status = 200) => new Response(JSON.stringify({ me: { role: who.role, id: who.id, name: who.name }, notes }), { status, headers: noStore });
  if (request.method === 'GET') return reply();
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let b = {}; try { b = await request.json(); } catch {}
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v) => (v !== null && v !== '' && Number.isFinite(+v) ? +(+v).toFixed(4) : null);
  if (b.action === 'add') {
    const text = str(b.text, 2000).trim();
    if (!text) return bad('empty note');
    if (notes.length >= NOTES_MAX) return bad('too many notes');
    notes.push({ id: crypto.randomUUID(), page: str(b.page, 80), skin: b.skin === 'new' ? 'new' : 'classic', anchor: str(b.anchor, 80),
      fx: num(b.fx), fy: num(b.fy), px: num(b.px), py: num(b.py), context: str(b.context, 120), text,
      by: who.id, byName: who.name, at: new Date().toISOString(), done: false });
  } else {
    const n = notes.find((x) => x.id === b.id);
    if (!n) return bad('no such note');
    if (b.action === 'done' && who.role === 'owner') n.done = b.done !== false;
    else if (b.action === 'delete' && (who.role === 'owner' || n.by === who.id)) notes.splice(notes.indexOf(n), 1);
    else return new Response(JSON.stringify({ error: 'not allowed' }), { status: 403, headers: noStore });
  }
  await env.LIVE.put(NOTES_KEY, JSON.stringify(notes));
  return reply();
}

/* Owner-only: a short street address for a point (stops on the map and in the activity log).
   Looked up at OpenStreetMap's Nominatim and cached at Cloudflare for 30 days per ~100 m square, which
   keeps well inside Nominatim's usage policy. Only the rounded point is sent: no names or other details. */
export function shortAddress(a) {
  if (!a) return null;
  const parts = [a.amenity || a.building || a.shop || a.office, a.road, a.neighbourhood || a.quarter || a.suburb, a.city || a.town || a.village || a.county];
  const out = [];
  for (const p of parts) if (p && !out.includes(p)) out.push(p);
  return out.length ? out.join(', ') : null;
}
async function servePlace(url) {
  const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return bad('bad point');
  const la = lat.toFixed(3), lo = lon.toFixed(3);
  const key = new Request('https://place-cache.invalid/' + la + ',' + lo);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(key); if (hit) return new Response(hit.body, { headers: noStore }); }
  let place = null;
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=en&lat=' + la + '&lon=' + lo,
      { headers: { 'User-Agent': 'dc-forest-tracker/1.0 (fleet dashboard)', 'Accept': 'application/json' } });
    if (r.ok) { const j = await r.json(); place = shortAddress(j.address) || j.display_name || null; }
  } catch {}
  const body = JSON.stringify({ lat: +la, lon: +lo, place });
  if (cache && place) await cache.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } }));
  return new Response(body, { headers: noStore });
}

const OWNER_PAGES = /^\/(control|dashboard)(\.html)?\/?$/;
const OWNER_APIS = /^\/api\/(fleet|trail|activity|report|place|notes)\.json$|^\/(owner-tools|notes)\.js$|^\/staff\//;   // staff/: staff photos, shown only on owner pages
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (msg) => new Response(JSON.stringify({ error: msg }), { status: 400, headers: noStore });

/* Owner-only: every vehicle's day (moving / stopped time, stops, km) for one Pakistan date. */
async function serveActivity(env, url) {
  const date = url.searchParams.get('date') || pkDate(Date.now());
  if (!DATE_RE.test(date)) return bad('bad date');
  const trail = (await env.LIVE.get(trailKey(date), 'json')) || { v: {} };
  const vehicles = {};
  for (const [reg, pts] of Object.entries(trail.v || {})) vehicles[reg] = summarizeDay(pts);
  return new Response(JSON.stringify({ date, today: pkDate(Date.now()), keptDays: TRAIL_DAYS, vehicles }), { headers: noStore });
}

/* Owner-only: per-vehicle daily totals over a date range (up to the 31 days that are kept). */
async function serveReport(env, url) {
  const today = pkDate(Date.now());
  const to = url.searchParams.get('to') || today, from = url.searchParams.get('from') || to;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return bad('bad range');
  const days = dateRange(from, to, TRAIL_DAYS);
  const trails = await Promise.all(days.map((d) => env.LIVE.get(trailKey(d), 'json')));
  const vehicles = {};
  days.forEach((d, i) => {
    for (const [reg, pts] of Object.entries((trails[i] && trails[i].v) || {})) {
      const s = summarizeDay(pts); if (!s) continue;
      (vehicles[reg] = vehicles[reg] || {})[d] = { km: s.km, movingMin: s.movingMin, stoppedMin: s.stoppedMin, firstMove: s.firstMove, lastMove: s.lastMove, points: s.points, maxSpeed: s.maxSpeed };
    }
  });
  return new Response(JSON.stringify({ from, to: days[days.length - 1], days, recordedDays: days.filter((d, i) => trails[i]), vehicles }), { headers: noStore });
}

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
      if (!(await gate.canView(request, env))) {
        return OWNER_APIS.test(url.pathname)
          ? new Response(JSON.stringify({ error: 'owner-only' }), { status: 403, headers: noStore })
          : gate.ownerPage();
      }
      if (url.pathname === '/api/notes.json') return serveNotes(request, env, await gate.viewer(request, env));
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (url.pathname === '/api/fleet.json') return serveFleet(env);
      if (url.pathname === '/api/trail.json') return serveTrail(env, url);
      if (url.pathname === '/api/activity.json') return serveActivity(env, url);
      if (url.pathname === '/api/report.json') return serveReport(env, url);
      if (url.pathname === '/api/place.json') return servePlace(url);
      if (url.pathname.startsWith('/staff/')) {
        const f = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
        const h = new Headers(f.headers); h.set('Cache-Control', 'private, no-store'); h.set('X-Robots-Tag', 'noindex');
        return new Response(f.body, { status: f.status, headers: h });
      }
      if (url.pathname === '/owner-tools.js' || url.pathname === '/notes.js') {
        const js = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
        return new Response(js.body, { status: js.status, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      const name = OWNER_PAGES.exec(url.pathname)[1], theme = gate.themeFor(request);
      // On the classic design the owner's dashboard is the classic page itself, with the owner tools added.
      if (name === 'dashboard' && theme === 'classic') return new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store' } });
      return withScripts(await themed(await ownerPage(env, url, name), theme), ['notes.js']);
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
    if (!env.ASSETS) return new Response('Not found', { status: 404 });
    // The classic page is always reachable at /classic (the new design reads the staff list from it).
    const owner = await gate.canView(request, env);   // owner or reviewer
    if (url.pathname === '/classic') return classicPage(env, url, owner);
    // Home page: the classic page (plus owner tools for the owner), or the new design on a device where the owner picked it.
    if ((url.pathname === '/' || url.pathname === '/index.html') && request.method === 'GET') {
      if (owner && gate.themeFor(request) === 'new') return themed(await ownerPage(env, url, 'dashboard'), 'new');
      if (owner) return classicPage(env, url, true);
    }
    return env.ASSETS.fetch(request);
  },
};
