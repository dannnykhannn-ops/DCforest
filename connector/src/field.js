/* Field rules: places, schedules, unscheduled-stop alerts, the staff buzzer and the reasons catalog.

   KV keys
     field:places    [{ id, name, lat, lon, radius }]                 nurseries, offices, other allowed places
     field:assign    { REG: { places:[id], days:[0-6], start:'08:00', end:'16:00', off:false } }
     field:cfg       { stopMin, answerMin, buzzMin, dutyDays, dutyStart, dutyEnd }
     field:inc       [incident]   last 31 days (see newIncident)
     rec:<incidentId>  the voice recording (binary), kept 90 days
     push:subs       [{ who:'owner'|'staff', id, reg, sub }]           Web Push subscriptions
     push:vapid      { pub, jwk }                                     server's push signing key (made on first use)

   Push messages carry no content: the phone wakes up and asks the server what to show (/api/push/what),
   so nothing personal travels through the push services. */

import { metres, pkDate } from './transform.js';

const PK = 5 * 3600000;
export const DEFAULTS = { stopMin: 15, answerMin: 10, buzzMin: 2, dutyDays: [1, 2, 3, 4, 5, 6], dutyStart: '08:00', dutyEnd: '16:00', radius: 150 };
const KEEP_DAYS = 31, REC_DAYS = 90, MAX_BUZZ_MIN = 120, SAME_SPOT_M = 120;

const j = (env, k) => env.LIVE.get(k, 'json');
const put = (env, k, v) => env.LIVE.put(k, JSON.stringify(v));
export async function loadField(env) {
  const [places, assign, cfg] = await Promise.all([j(env, 'field:places'), j(env, 'field:assign'), j(env, 'field:cfg')]);
  return { places: places || [], assign: assign || {}, cfg: { ...DEFAULTS, ...(cfg || {}) } };
}
const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
function pkClock(ms) { const d = new Date(ms + PK); return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }

/** Is this person on duty at `ms`? Their own schedule if set, else the division's duty hours. */
export function onDuty(rule, cfg, ms) {
  const c = pkClock(ms), days = (rule && rule.days) || cfg.dutyDays;
  const a = hhmm((rule && rule.start) || cfg.dutyStart), b = hhmm((rule && rule.end) || cfg.dutyEnd);
  return days.includes(c.day) && a !== null && b !== null && c.min >= a && c.min < b;
}
/** The nearest allowed place within its radius, or null. */
export function allowedPlace(rule, places, lat, lon) {
  for (const id of (rule && rule.places) || []) {
    const p = places.find((x) => x.id === id);
    if (p && metres(lat, lon, p.lat, p.lon) <= (p.radius || DEFAULTS.radius)) return p;
  }
  return null;
}
/** The stop the bike is in right now: points at the end of the day's trail within SAME_SPOT_M of the last one.
    Returns { from, to, lat, lon } or null when it is moving or has too little data. */
export function currentStop(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const last = pts[pts.length - 1]; let i = pts.length - 1;
  while (i > 0 && metres(pts[i - 1][1], pts[i - 1][2], last[1], last[2]) <= SAME_SPOT_M && (pts[i - 1][3] ?? 0) < 3) i--;
  if (i === pts.length - 1) return null;
  if ((last[3] ?? 0) >= 3) return null;
  return { from: pts[i][0], to: last[0], lat: last[1], lon: last[2] };
}

/** Run after every sync: open an incident for each new unscheduled stop. Returns the incidents opened. */
export async function detect(env, trail, now, names) {
  const f = await loadField(env);
  const regs = Object.keys(f.assign).filter((r) => f.assign[r] && !f.assign[r].off && (f.assign[r].places || []).length);
  if (!regs.length || !trail || !trail.v) return [];
  let inc = (await j(env, 'field:inc')) || [];
  const opened = [];
  for (const reg of regs) {
    const rule = f.assign[reg], s = currentStop(trail.v[reg]);
    if (!s || now / 1000 - s.to > 15 * 60) continue;                     // no fresh report: the tracker may be off
    if ((s.to - s.from) / 60 < f.cfg.stopMin) continue;
    if (!onDuty(rule, f.cfg, s.from * 1000)) continue;
    if (allowedPlace(rule, f.places, s.lat, s.lon)) continue;
    if (inc.some((x) => x.reg === reg && Math.abs(x.from - s.from) < 20 * 60 && metres(x.lat, x.lon, s.lat, s.lon) < SAME_SPOT_M)) continue;
    const x = { id: crypto.randomUUID(), reg, name: rule.name || (names && names[reg]) || reg, from: s.from, lat: s.lat, lon: s.lon,
      detectedAt: new Date(now).toISOString(), status: 'open', buzzes: 0, lastBuzz: null, escalated: false, answer: null, review: null };
    inc.push(x); opened.push(x);
  }
  if (!opened.length) return [];
  const cutoff = now - KEEP_DAYS * 86400000;
  inc = inc.filter((x) => Date.parse(x.detectedAt) > cutoff);
  await put(env, 'field:inc', inc);
  return opened;
}

/** Every minute: buzz the staff phone again until answered; escalate to the owner after answerMin. */
export async function buzzTick(env, now) {
  const inc = (await j(env, 'field:inc')) || [];
  const open = inc.filter((x) => x.status === 'open' && now - Date.parse(x.detectedAt) < MAX_BUZZ_MIN * 60000);
  if (!open.length) return { sent: 0 };
  const { cfg } = await loadField(env);
  let changed = false, sent = 0;
  for (const x of open) {
    const age = (now - Date.parse(x.detectedAt)) / 60000;
    const every = x.escalated ? 1 : cfg.buzzMin;                         // more often once escalated
    if (!x.lastBuzz || (now - Date.parse(x.lastBuzz)) / 60000 >= every - 0.1) {
      sent += await pushTo(env, (s) => s.who === 'staff' && s.reg === x.reg);
      x.buzzes++; x.lastBuzz = new Date(now).toISOString(); changed = true;
    }
    if (!x.escalated && age >= cfg.answerMin) {
      x.escalated = true; changed = true;
      sent += await pushTo(env, (s) => s.who === 'owner');
    }
  }
  if (changed) await put(env, 'field:inc', inc);
  return { sent };
}

/* ---------------- Web Push (no payload, VAPID) ---------------- */
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function vapid(env) {
  let v = await j(env, 'push:vapid');
  if (v) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  v = { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  await put(env, 'push:vapid', v);
  return v;
}
export async function vapidPublic(env) { return (await vapid(env)).pub; }
async function sendPush(env, sub) {
  const v = await vapid(env);
  const aud = new URL(sub.endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://dcforest.vercel.app' })));
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: `vapid t=${head}.${body}.${sig}, k=${v.pub}`, TTL: '300', Urgency: 'high', 'Content-Length': '0' } });
  return r.status;
}
/** Push to every saved subscription that matches; drops subscriptions the push service says are gone. */
export async function pushTo(env, match) {
  const subs = (await j(env, 'push:subs')) || [];
  let sent = 0, gone = [];
  for (const s of subs.filter(match)) {
    try { const st = await sendPush(env, s.sub); if (st === 404 || st === 410) gone.push(s.sub.endpoint); else if (st < 300) sent++; } catch {}
  }
  if (gone.length) await put(env, 'push:subs', subs.filter((s) => !gone.includes(s.sub.endpoint)));
  return sent;
}

/* ---------------- HTTP ---------------- */
const H = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });
const bad = (m, s = 400) => ok({ error: m }, s);
async function body(req) { try { return await req.json(); } catch { return {}; } }

/** Owner/reviewer API: /api/field/... (reviewers may read, only the owner may change). */
export async function ownerApi(request, env, url, who) {
  const p = url.pathname.slice('/api/field/'.length), owner = who.role === 'owner';
  if (p === 'setup' && request.method === 'GET') return ok({ ...(await loadField(env)), vapid: await vapidPublic(env) });
  if (p === 'incidents' && request.method === 'GET') {
    const inc = (await j(env, 'field:inc')) || [];
    const reg = url.searchParams.get('reg'), from = url.searchParams.get('from'), to = url.searchParams.get('to');
    return ok({ incidents: inc.filter((x) => (!reg || x.reg === reg) && (!from || pkDate(Date.parse(x.detectedAt)) >= from) && (!to || pkDate(Date.parse(x.detectedAt)) <= to)).reverse() });
  }
  if (p.startsWith('rec/') && request.method === 'GET') {
    const id = p.slice(4).replace(/[^\w-]/g, '');
    const r = await env.LIVE.getWithMetadata('rec:' + id, 'arrayBuffer');
    if (!r || !r.value) return new Response('Not found', { status: 404 });
    return new Response(r.value, { headers: { 'Content-Type': (r.metadata && r.metadata.type) || 'audio/webm', 'Cache-Control': 'private, no-store' } });
  }
  if (request.method !== 'POST') return bad('method', 405);
  if (p === 'subscribe') {                                                  // owner/reviewer phone: escalations
    const b = await body(request); if (!b.sub || !b.sub.endpoint) return bad('no subscription');
    return saveSub(env, { who: 'owner', id: who.id, sub: b.sub });
  }
  if (!owner) return bad('owner only', 403);
  const b = await body(request);
  if (p === 'places') {
    if (!Array.isArray(b.places)) return bad('places');
    const places = b.places.slice(0, 300).map((x) => ({ id: String(x.id || crypto.randomUUID()).slice(0, 40), name: String(x.name || 'Place').slice(0, 80),
      lat: +x.lat, lon: +x.lon, radius: Math.max(30, Math.min(2000, Math.round(+x.radius || DEFAULTS.radius))), kind: String(x.kind || 'nursery').slice(0, 20) }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
    await put(env, 'field:places', places); return ok({ places });
  }
  if (p === 'assign') {
    if (!b.assign || typeof b.assign !== 'object') return bad('assign');
    const a = {};
    for (const [reg, r] of Object.entries(b.assign).slice(0, 200)) a[String(reg).slice(0, 20)] = { name: String(r.name || '').slice(0, 60), places: (r.places || []).map(String).slice(0, 20),
      days: Array.isArray(r.days) ? r.days.map(Number).filter((d) => d >= 0 && d <= 6) : undefined, start: hhmm(r.start) !== null ? r.start : undefined,
      end: hhmm(r.end) !== null ? r.end : undefined, off: r.off === true };
    await put(env, 'field:assign', a); return ok({ assign: a });
  }
  if (p === 'cfg') {
    const c = { ...DEFAULTS, ...((await j(env, 'field:cfg')) || {}) };
    for (const k of ['stopMin', 'answerMin', 'buzzMin']) if (Number.isFinite(+b[k])) c[k] = Math.max(1, Math.min(240, Math.round(+b[k])));
    if (Array.isArray(b.dutyDays)) c.dutyDays = b.dutyDays.map(Number).filter((d) => d >= 0 && d <= 6);
    if (hhmm(b.dutyStart) !== null) c.dutyStart = b.dutyStart; if (hhmm(b.dutyEnd) !== null) c.dutyEnd = b.dutyEnd;
    await put(env, 'field:cfg', c); return ok({ cfg: c });
  }
  if (p === 'review') {
    const inc = (await j(env, 'field:inc')) || [], x = inc.find((i) => i.id === b.id);
    if (!x) return bad('no such stop', 404);
    x.review = ['accepted', 'follow-up'].includes(b.review) ? b.review : null;
    if (b.status === 'closed') x.status = 'closed';
    await put(env, 'field:inc', inc); return ok({ incident: x });
  }
  if (p === 'test') {                                                       // owner: send a test buzz to one bike
    const reg = String(b.reg || '');
    const sent = await pushTo(env, (s) => s.who === 'staff' && s.reg === reg);
    return ok({ sent });
  }
  return bad('unknown', 404);
}

async function saveSub(env, rec) {
  const subs = (await j(env, 'push:subs')) || [];
  const keep = subs.filter((s) => s.sub.endpoint !== rec.sub.endpoint);
  keep.push({ ...rec, at: new Date().toISOString() });
  await put(env, 'push:subs', keep.slice(-300));
  return ok({ ok: true });
}

/** Staff phone API: /api/me/... (only their own bike). */
export async function staffApi(request, env, url, me) {
  const p = url.pathname.slice('/api/me/'.length);
  if (p === 'state' && request.method === 'GET') {
    const inc = ((await j(env, 'field:inc')) || []).filter((x) => x.reg === me.reg);
    const { cfg } = await loadField(env);
    return ok({ me, vapid: await vapidPublic(env), cfg: { answerMin: cfg.answerMin },
      open: inc.filter((x) => x.status === 'open').reverse(), recent: inc.filter((x) => x.status !== 'open').slice(-20).reverse() });
  }
  if (request.method !== 'POST') return bad('method', 405);
  if (p === 'subscribe') {
    const b = await body(request); if (!b.sub || !b.sub.endpoint) return bad('no subscription');
    return saveSub(env, { who: 'staff', id: me.id, reg: me.reg, sub: b.sub });
  }
  if (p.startsWith('answer/')) {
    const id = p.slice(7).replace(/[^\w-]/g, '');
    const inc = (await j(env, 'field:inc')) || [], x = inc.find((i) => i.id === id && i.reg === me.reg);
    if (!x) return bad('no such stop', 404);
    const type = (request.headers.get('Content-Type') || '').split(';')[0];
    let reason = url.searchParams.get('reason') || '', text = url.searchParams.get('text') || '', audio = false;
    if (type.startsWith('audio/')) {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > 6 * 1024 * 1024) return bad('recording too long');
      if (buf.byteLength > 0) { await env.LIVE.put('rec:' + id, buf, { expirationTtl: REC_DAYS * 86400, metadata: { type } }); audio = true; }
    } else { const b = await body(request); reason = b.reason || reason; text = b.text || text; }
    if (!audio && !String(text).trim()) return bad('record a voice note or write the reason');
    x.status = 'answered';
    x.answer = { at: new Date().toISOString(), reason: String(reason).slice(0, 40), text: String(text).slice(0, 1000), audio: audio || !!(x.answer && x.answer.audio), late: x.escalated };
    await put(env, 'field:inc', inc);
    return ok({ incident: x });
  }
  return bad('unknown', 404);
}

/** What a woken phone should show (called by the service worker after a push). */
export async function pushWhat(env, owner, me) {
  const inc = (await j(env, 'field:inc')) || [];
  if (me) {
    const x = inc.filter((i) => i.reg === me.reg && i.status === 'open').pop();
    return ok(x ? { title: x.escalated ? '⚠ NO REASON GIVEN — answer now' : 'Unscheduled stop — record the reason', body: 'Tap to record why you stopped here. It keeps buzzing until you answer.', url: '/staff', urgent: true, tag: 'stop-' + x.id }
      : { title: 'DC Forest', body: 'No open alerts.', url: '/staff', tag: 'none' });
  }
  if (owner) {
    const x = inc.filter((i) => i.status === 'open' && i.escalated).pop();
    return ok(x ? { title: 'No reason from ' + x.name, body: x.reg + ' stopped outside assigned places and has not answered.', url: '/person?reg=' + encodeURIComponent(x.reg), urgent: true, tag: 'esc-' + x.id }
      : { title: 'DC Forest', body: 'Nothing new.', url: '/today', tag: 'none' });
  }
  return ok({ title: 'DC Forest', body: '', url: '/', tag: 'none' });
}
