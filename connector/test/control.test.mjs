/* Control Room: positions and trails are owner-only. Synthetic data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { buildPositions, appendTrail, trailKm, pkDate, position } from '../src/transform.js';
import { memoryKV } from '../scripts/env.mjs';

const NOW = Date.parse('2026-11-16T08:00:00Z');                 // 13:00 in Pakistan
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const veh = (reg, data) => ({ imei: 'x' + reg, registration_no: reg, data });

test('position keeps missing values null and treats 0,0 as no position', () => {
  assert.deepEqual(position(veh('A', { lat: '0', lon: '0', ts: ago(1) })).lat, null);
  const p = position(veh('A', { lat: '31.5', lon: '74.3', ts: ago(1) }));
  assert.equal(p.lat, 31.5); assert.equal(p.speed, null); assert.equal(p.ignition, null);
  const off = buildPositions([veh('B', { lat: '31.5', lon: '74.3', ts: ago(5000) })], NOW)[0];
  assert.equal(off.state, 'none'); assert.equal(off.lat, 31.5, 'offline vehicles keep their last known position');
});

test('trail appends only new, positioned, same-day reports', () => {
  const date = pkDate(NOW);
  assert.equal(date, '2026-11-16');
  const p = (reg, min, lat, lon) => ({ reg, lat, lon, speed: 10, reportedAt: ago(min) });
  let tr = appendTrail(null, [p('A', 20, 31.5, 74.3), p('B', 3000, 31.5, 74.3), { reg: 'C', lat: null, lon: null, reportedAt: ago(1) }], date);
  assert.deepEqual(Object.keys(tr.v), ['A']);                    // B is from another day, C has no position
  tr = appendTrail(tr, [p('A', 20, 31.6, 74.3)], date);         // same report again: not duplicated
  assert.equal(tr.v.A.length, 1);
  tr = appendTrail(tr, [p('A', 10, 31.51, 74.3)], date);
  assert.equal(tr.v.A.length, 2);
  assert.ok(Math.abs(trailKm(tr.v.A) - 1.1) < 0.05);
  assert.equal(trailKm([tr.v.A[0]]), null, 'one point is not a distance');
  assert.equal(appendTrail(tr, [], '2026-11-17').v.A, undefined, 'a new day starts empty');
});

test('a 500 km jump between reports is ignored as a GPS glitch', () => {
  const t = 1_000_000;
  assert.equal(trailKm([[t, 31.5, 74.3], [t + 300, 36, 74.3], [t + 600, 31.51, 74.3]]), 0);
});

const newEnv = (open) => ({
  LIVE: memoryKV({
    'gate:config': JSON.stringify({ open }),
    'live:latest': JSON.stringify({ schema: 1, fetchedAt: new Date().toISOString(), summary: { total: 1 }, vehicles: [{ reg: 'A', state: 'moving', signal: 'strong' }],
      positions: [{ reg: 'A', state: 'moving', signal: 'strong', lat: 31.5, lon: 74.3, speed: 20, ignition: 'on', reportedAt: new Date().toISOString() }] }),
  }),
  ADMIN_PIN: '4321', SESSION_SECRET: 'test-secret-test-secret-test',
  // Behaves like Cloudflare's default html_handling: "/x.html" redirects to "/x", and "/x" serves x.html.
  ASSETS: { fetch: async (r) => {
    const p = new URL(r.url).pathname;
    if (p.endsWith('.html')) return new Response(null, { status: 307, headers: { Location: p.slice(0, -5) } });
    return new Response('PAGE:' + (p === '/' ? '/index.html' : p + '.html'));
  } },
});
const call = (env, path, { method = 'GET', body, cookie } = {}) => worker.fetch(new Request('http://x' + path, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
}), env);

test('positions never appear in the public live.json', async () => {
  const body = await (await call(newEnv(true), '/api/live.json')).text();
  assert.ok(!body.includes('31.5') && !body.includes('positions'));
});

test('Control Room and its data need the owner, even when the site is open to everyone', async () => {
  const env = newEnv(true);
  assert.equal((await call(env, '/api/fleet.json')).status, 403);
  assert.equal((await call(env, '/api/trail.json')).status, 403);
  const page = await call(env, '/control');
  assert.equal(page.status, 401);
  assert.ok(!(await page.text()).startsWith('PAGE:'));
  assert.equal((await call(env, '/control.html')).status, 401);

  const guest = (await call(env, '/api/gate/me')).status;           // anonymous: no role
  assert.equal(guest, 200);
  const owner = ((await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '4321' } })).headers.get('Set-Cookie') || '').split(';')[0];
  assert.equal((await (await call(env, '/api/gate/me', { cookie: owner })).json()).role, 'owner');
  const fleet = await (await call(env, '/api/fleet.json', { cookie: owner })).json();
  assert.equal(fleet.vehicles[0].lat, 31.5);
  for (const path of ['/control', '/control.html', '/control/']) {
    const res = await call(env, path, { cookie: owner });
    assert.equal(res.status, 200, path + ' must not hand a redirect to the browser');
    assert.equal(await res.text(), 'PAGE:/control.html');
  }
  for (const path of ['/dashboard', '/dashboard.html']) {
    assert.equal((await call(env, path)).status, 401, path + ' is owner-only');
    const classic = await call(env, path, { cookie: owner });
    assert.equal(classic.status, 302, 'on the classic design the dashboard is the classic page'); assert.equal(classic.headers.get('Location'), '/');
    const res = await call(env, path, { cookie: owner + '; dcf_theme=new' });
    assert.equal(res.status, 200); assert.equal(await res.text(), 'PAGE:/dashboard.html');
  }
  const trail = await (await call(env, '/api/trail.json?date=2026-11-16', { cookie: owner })).json();
  assert.deepEqual(trail.vehicles, {});
  assert.equal((await call(env, '/api/trail.json?date=../../x', { cookie: owner })).status, 400);
});

import { summarizeDay, dateRange } from '../src/transform.js';
test('a day: moving and stopped time, stops, km; long silences are not counted as either', () => {
  const t0 = Date.parse('2026-11-16T04:00:00Z') / 1000, m = 300;   // 9:00 PKT, 5-minute steps
  const pts = [
    [t0, 31.50, 74.30, 0], [t0 + m, 31.50, 74.30, 0], [t0 + 2 * m, 31.50, 74.30, 0], [t0 + 3 * m, 31.50, 74.30, 0],  // 15 min parked
    [t0 + 4 * m, 31.51, 74.30, 30], [t0 + 5 * m, 31.52, 74.30, 28],                                                    // driving
    [t0 + 6 * m, 31.52, 74.30, 0],
    [t0 + 6 * m + 7200, 31.52, 74.30, 0],                                                                              // 2 h silence
  ];
  const s = summarizeDay(pts);
  assert.equal(s.stoppedMin, 15); assert.equal(s.movingMin, 15); assert.equal(s.noDataMin, 120);
  assert.equal(s.firstMove, t0 + 3 * m); assert.equal(s.lastMove, t0 + 6 * m);
  assert.equal(s.stops.length, 1); assert.equal(s.stops[0].min, 15);
  assert.ok(s.km > 2 && s.km < 2.4, 'about 2.2 km');
  assert.equal(s.maxSpeed, 30);
  assert.equal(summarizeDay([]), null);
  assert.equal(summarizeDay([[t0, 31.5, 74.3, null]]).km, 0);
});

test('date ranges are capped', () => {
  assert.deepEqual(dateRange('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.equal(dateRange('2026-01-01', '2026-12-31').length, 31);
});

test('activity and report need the owner and check their dates', async () => {
  const env = newEnv(true);
  assert.equal((await call(env, '/api/activity.json')).status, 403);
  assert.equal((await call(env, '/api/report.json')).status, 403);
  const owner = ((await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '4321' } })).headers.get('Set-Cookie') || '').split(';')[0];
  await env.LIVE.put('trail:2026-11-16', JSON.stringify({ date: '2026-11-16', v: { A: [[1, 31.5, 74.3, 20], [301, 31.51, 74.3, 20]] } }));
  const a = await (await call(env, '/api/activity.json?date=2026-11-16', { cookie: owner })).json();
  assert.equal(a.vehicles.A.movingMin, 5);
  const r = await (await call(env, '/api/report.json?from=2026-11-15&to=2026-11-16', { cookie: owner })).json();
  assert.deepEqual(r.recordedDays, ['2026-11-16']); assert.ok(r.vehicles.A['2026-11-16'].km > 1);
  assert.equal((await call(env, '/api/report.json?from=2026-11-17&to=2026-11-16', { cookie: owner })).status, 400);
  assert.equal((await call(env, '/api/activity.json?date=x', { cookie: owner })).status, 400);
});

test('design switch changes only the owner device that picked it; visitors always get classic', async () => {
  const html = (name) => new Response('<!DOCTYPE html><html lang="en"><body>' + name + '</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const env = newEnv(true);
  env.ASSETS = { fetch: async (r) => {
    const p = new URL(r.url).pathname;
    if (p.endsWith('.html')) return new Response(null, { status: 307, headers: { Location: p === '/index.html' ? '/' : p.slice(0, -5) } });
    return html(p === '/' ? 'CLASSIC-HOME' : 'PAGE' + p);
  } };
  const page = async (path, cookie) => (await call(env, path, { cookie })).text();
  assert.match(await page('/'), /CLASSIC-HOME/);
  assert.equal((await call(env, '/api/gate/theme', { method: 'POST', body: { theme: 'new' } })).status, 403, 'only the owner can switch');

  const owner = ((await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '4321' } })).headers.get('Set-Cookie') || '').split(';')[0];
  assert.match(await page('/control', owner), /data-skin="classic"/);
  assert.match(await page('/', owner), /owner-tools\.js/, 'the owner gets the owner tools on the classic page');
  assert.doesNotMatch(await page('/'), /owner-tools/, 'visitors do not');
  assert.equal((await call(env, '/owner-tools.js')).status, 403);
  assert.equal((await call(env, '/staff/photos.json')).status, 403, 'staff photos are owner-only even when the site is open');
  assert.equal((await call(env, '/staff/khalid-nadeem.webp')).status, 403);
  assert.equal((await call(env, '/staff/photos.json', { cookie: owner })).status, 200);
  const res = await call(env, '/api/gate/theme', { method: 'POST', body: { theme: 'new' }, cookie: owner });
  assert.equal((await res.json()).theme, 'new');
  const themeCookie = (res.headers.get('Set-Cookie') || '').split(';')[0];
  assert.equal(themeCookie, 'dcf_theme=new');
  const mine = owner + '; ' + themeCookie;

  assert.match(await page('/', mine), /PAGE\/dashboard/); assert.match(await page('/', mine), /data-skin="new"/);
  assert.match(await page('/control', mine), /data-skin="new"/);
  assert.equal((await (await call(env, '/api/gate/me', { cookie: mine })).json()).theme, 'new');
  assert.match(await page('/'), /CLASSIC-HOME/, 'a visitor still gets the classic page');
  assert.match(await page('/', owner), /CLASSIC-HOME/, 'another device of the owner is unaffected');
  assert.match(await page('/classic', mine), /CLASSIC-HOME/);
  assert.equal((await call(env, '/api/fleet.json')).status, 403);

  const back = await call(env, '/api/gate/theme', { method: 'POST', body: { theme: 'classic' }, cookie: mine });
  assert.match(back.headers.get('Set-Cookie') || '', /dcf_theme=classic;.*Max-Age=0/);
  assert.match(await page('/', owner + '; dcf_theme=classic'), /CLASSIC-HOME/);
});
