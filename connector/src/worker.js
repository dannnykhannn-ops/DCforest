/* DC Forest live-fleet connector (Cloudflare Worker).

   Every 5 minutes (cron) : portal feed -> validate -> transform -> KV "live:latest".
   GET /api/live.json     : serves the last successful snapshot plus freshness flags.
   Anything else          : static site, if this Worker is deployed with the site as its assets.

   Secrets (never in the site's code): PORTAL_TOKEN.
   Vars: ALLOWED_ORIGIN (optional, for a site hosted elsewhere), STALE_AFTER_SECONDS. */

import { fetchFleetSnapshot, tokenInfo } from './portal.js';
import { buildSnapshot, validateSnapshot } from './transform.js';
import * as gate from './gate.js';

const KEY_LATEST = 'live:latest';   // last SUCCESSFUL snapshot; only ever overwritten by another success
const KEY_STATUS = 'live:status';   // last failed attempt; written only on failure

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

    await env.LIVE.put(KEY_LATEST, JSON.stringify(snapshot));
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
  const { authExpiresAt, ...pub } = latest;
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

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sync(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);

    // Access gate: the entry page and its API first, then everything except images/icons needs a session.
    const gateResponse = await gate.route(request, env, url);
    if (gateResponse) return gateResponse;
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
