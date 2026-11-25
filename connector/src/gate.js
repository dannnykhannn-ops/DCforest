/* Access gate. Everything is decided here on the server: the site's page and its live numbers are only
   sent to a browser that holds a valid session. Nothing about the PIN or the passes is in the site's code.

   - Visitor: enters a one-time pass -> the pass is used up -> that browser gets a session (GUEST_SESSION_MINUTES, 30 by default).
   - Owner:   clicks the infinity box, enters the PIN -> can create / cancel passes, open the site to
              everyone, or sign everyone out.
   Secrets: ADMIN_PIN, SESSION_SECRET.  State: KV key "gate:config". */

import { GATE_PAGE } from './gate-page.js';

const CFG_KEY = 'gate:config';
const COOKIE = 'dcf_s';
const MAX_FAILS = 5;                      // wrong tries before a lock
const LOCK_MS = 30 * 60 * 1000;           // lock length
const PASS_TTL_MS = 7 * 86400000;         // an unused pass expires after 7 days
const ADMIN_HOURS = 12;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I, L, O, 0, 1: easy to read out
const PUBLIC = [/^\/assets\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/];   // images, icons, video only

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const secretOf = (env, name) => String(env[name] || '').trim();
const configured = (env) => secretOf(env, 'ADMIN_PIN').length >= 4 && secretOf(env, 'SESSION_SECRET').length >= 16;

async function loadCfg(env) {
  const c = (await env.LIVE.get(CFG_KEY, 'json')) || {};
  return { open: c.open === true, gen: c.gen || 1, passes: Array.isArray(c.passes) ? c.passes : [], fails: c.fails || {},
    theme: c.theme === 'new' ? 'new' : 'classic' };
}
const saveCfg = (env, cfg) => env.LIVE.put(CFG_KEY, JSON.stringify(cfg));

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
function page(status) {
  return new Response(GATE_PAGE, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

const guestMinutes = (env) => Number(env.GUEST_SESSION_MINUTES) || 30;
async function makeCookie(env, role, gen, minutes) {
  const body = b64u(enc.encode(JSON.stringify({ r: role, g: gen, e: Date.now() + minutes * 60000 })));
  const sig = await hmac(secretOf(env, 'SESSION_SECRET'), body);
  return `${COOKIE}=${body}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(minutes * 60)}`;
}
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function readSession(request, env, cfg) {
  if (!configured(env)) return null;
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec(request.headers.get('Cookie') || '');
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig || !same(sig, await hmac(secretOf(env, 'SESSION_SECRET'), body))) return null;
  try {
    const s = JSON.parse(unb64u(body));
    return s.g === cfg.gen && s.e > Date.now() && (s.r === 'guest' || s.r === 'admin') ? s : null;
  } catch { return null; }
}

/* Wrong-try limiter. Once locked, further tries are refused without touching storage. */
function lockedFor(cfg, bucket, now) {
  const f = cfg.fails[bucket];
  return f && f.until > now ? Math.ceil((f.until - now) / 60000) : 0;
}
function noteFail(cfg, bucket, now) {
  const f = cfg.fails[bucket] && cfg.fails[bucket].until <= now ? { n: cfg.fails[bucket].n || 0, until: 0 } : { n: 0, until: 0 };
  f.n++;
  if (f.n >= MAX_FAILS) { f.n = 0; f.until = now + LOCK_MS; }
  cfg.fails[bucket] = f;
}

function prune(cfg, now) {
  const unused = cfg.passes.filter((p) => !p.usedAt && now - Date.parse(p.createdAt) < PASS_TTL_MS);
  const used = cfg.passes.filter((p) => p.usedAt).slice(-20);
  cfg.passes = [...used, ...unused];
}
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const publicState = (cfg, env) => ({
  open: cfg.open,
  theme: cfg.theme,
  guestMinutes: guestMinutes(env),
  passes: cfg.passes.map((p) => ({ code: p.code, createdAt: p.createdAt, usedAt: p.usedAt || null })),
});

export const isPublic = (pathname) => PUBLIC.some((re) => re.test(pathname));

/** Site design chosen by the owner: 'classic' (default) or 'new'. Applies to every visitor. */
export async function siteTheme(env) { return (await loadCfg(env)).theme; }

/** True only for a valid owner session. Opening the site to everyone does not change this. */
export async function isOwner(request, env) {
  const s = await readSession(request, env, await loadCfg(env));
  return !!(s && s.r === 'admin');
}
/** Entry page for an owner-only address (the owner signs in with the PIN there). */
export const ownerPage = () => page(401);

/** Returns null when the request may proceed, otherwise the response to send instead. */
export async function guard(request, env, pathname) {
  const cfg = await loadCfg(env);
  if (cfg.open) return null;
  if (await readSession(request, env, cfg)) return null;
  return pathname.startsWith('/api/') ? json({ error: 'locked' }, 401) : page(401);
}

/** Handles /gate and /api/gate/*. Returns null for any other path. */
export async function route(request, env, url) {
  const p = url.pathname;
  if (p === '/gate') return page(200);
  if (!p.startsWith('/api/gate/')) return null;
  const action = p.slice('/api/gate/'.length);
  const now = Date.now();
  const cfg = await loadCfg(env);

  if (action === 'me' && request.method === 'GET') {
    const s = await readSession(request, env, cfg);
    return json({ role: s ? (s.r === 'admin' ? 'owner' : 'guest') : (cfg.open ? 'visitor' : null), theme: cfg.theme });
  }
  if (action === 'state' && request.method === 'GET') {
    const s = await readSession(request, env, cfg);
    return s && s.r === 'admin' ? json(publicState(cfg, env)) : json({ error: 'forbidden' }, 403);
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (action === 'leave') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
  if (!configured(env)) return json({ error: 'not-configured' }, 503);

  let body = {};
  try { body = await request.json(); } catch {}

  if (action === 'enter') {
    const wait = lockedFor(cfg, 'code', now);
    if (wait) return json({ error: 'locked', minutes: wait }, 429);
    const code = cleanCode(body.code);
    prune(cfg, now);
    const pass = code.length === 6 ? cfg.passes.find((x) => !x.usedAt && same(x.code, code)) : null;
    if (!pass) { noteFail(cfg, 'code', now); await saveCfg(env, cfg); return json({ error: 'invalid' }, 401); }
    pass.usedAt = new Date(now).toISOString();
    delete cfg.fails.code;
    await saveCfg(env, cfg);
    return json({ ok: true }, 200, { 'Set-Cookie': await makeCookie(env, 'guest', cfg.gen, guestMinutes(env)) });
  }

  if (action === 'admin') {
    const wait = lockedFor(cfg, 'pin', now);
    if (wait) return json({ error: 'locked', minutes: wait }, 429);
    if (!same(String(body.pin || '').trim(), secretOf(env, 'ADMIN_PIN'))) {
      noteFail(cfg, 'pin', now); await saveCfg(env, cfg);
      return json({ error: 'invalid' }, 401);
    }
    if (cfg.fails.pin) { delete cfg.fails.pin; await saveCfg(env, cfg); }
    return json({ ok: true, ...publicState(cfg, env) }, 200, { 'Set-Cookie': await makeCookie(env, 'admin', cfg.gen, ADMIN_HOURS * 60) });
  }

  // Everything below needs an owner session.
  const s = await readSession(request, env, cfg);
  if (!s || s.r !== 'admin') return json({ error: 'forbidden' }, 403);
  prune(cfg, now);

  if (action === 'pass') {
    if (cfg.passes.filter((x) => !x.usedAt).length >= 20) return json({ error: 'too-many' }, 400);
    const code = newCode();
    cfg.passes.push({ code, createdAt: new Date(now).toISOString(), usedAt: null });
    await saveCfg(env, cfg);
    return json({ ok: true, code, ...publicState(cfg, env) });
  }
  if (action === 'revoke') {
    const code = cleanCode(body.code);
    cfg.passes = cfg.passes.filter((x) => x.usedAt || x.code !== code);
    await saveCfg(env, cfg);
    return json({ ok: true, ...publicState(cfg, env) });
  }
  if (action === 'open') {
    cfg.open = body.open === true;
    await saveCfg(env, cfg);
    return json({ ok: true, ...publicState(cfg, env) });
  }
  if (action === 'theme') {
    cfg.theme = body.theme === 'new' ? 'new' : 'classic';
    await saveCfg(env, cfg);
    return json({ ok: true, ...publicState(cfg, env) });
  }
  if (action === 'signout') {
    cfg.gen++;                                    // every existing session (visitors and owner) stops working
    await saveCfg(env, cfg);
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
  }
  return json({ error: 'unknown' }, 404);
}
