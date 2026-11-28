/* Field rules: unscheduled stops, the staff buzzer and answers. Synthetic data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { currentStop, onDuty, allowedPlace, detect, buzzTick, DEFAULTS } from '../src/field.js';
import { memoryKV } from '../scripts/env.mjs';

const kvBin = () => { const kv = memoryKV(); const meta = new Map();
  const put = kv.put; kv.put = async (k, v, o) => { if (v instanceof ArrayBuffer) { kv._bin = kv._bin || new Map(); kv._bin.set(k, v); meta.set(k, o && o.metadata); return; } return put(k, v); };
  kv.getWithMetadata = async (k) => ({ value: kv._bin && kv._bin.get(k), metadata: meta.get(k) }); return kv; };
// Monday 1 Dec 2026, 10:00 Pakistan time
const MON10 = Date.parse('2026-12-01T05:00:00Z'), s = (ms) => Math.floor(ms / 1000);
const parked = (lat, lon, fromMin, toMin) => { const pts = []; for (let m = fromMin; m <= toMin; m += 5) pts.push([s(MON10 + m * 60000), lat, lon, 0]); return pts; };

test('the current stop is found at the end of the trail, and not while moving', () => {
  const pts = [[s(MON10 - 3600e3), 31.40, 74.20, 30], ...parked(31.5, 74.3, -25, 0)];
  const st = currentStop(pts); assert.equal(st.from, s(MON10 - 25 * 60000)); assert.equal(st.lat, 31.5);
  assert.equal(currentStop([...pts, [s(MON10 + 300e3), 31.52, 74.3, 35]]), null);
});
test('duty hours and allowed places', () => {
  assert.equal(onDuty(null, DEFAULTS, MON10), true);
  assert.equal(onDuty(null, DEFAULTS, Date.parse('2026-11-29T05:00:00Z')), false, 'Sunday');
  assert.equal(onDuty({ start: '11:00', end: '15:00' }, DEFAULTS, MON10), false);
  const places = [{ id: 'n1', lat: 31.5, lon: 74.3, radius: 150 }];
  assert.ok(allowedPlace({ places: ['n1'] }, places, 31.5005, 74.3005));
  assert.equal(allowedPlace({ places: ['n1'] }, places, 31.52, 74.3), null);
});

function envWith() {
  const env = { LIVE: kvBin(), ADMIN_PIN: '4321', SESSION_SECRET: 'test-secret-test-secret-test', ASSETS: { fetch: async (r) => new Response('PAGE:' + new URL(r.url).pathname, { headers: { 'Content-Type': 'text/html' } }) } };
  return env;
}
const call = (env, path, { method = 'GET', body, cookie, type } = {}) => worker.fetch(new Request('http://x' + path, {
  method, body: body === undefined ? undefined : (body instanceof ArrayBuffer ? body : JSON.stringify(body)),
  headers: { ...(body !== undefined ? { 'Content-Type': type || 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } }), env);
const ck = (r) => (r.headers.get('Set-Cookie') || '').split(';')[0];

test('a long stop outside assigned places opens one alert; inside, or off duty, it does not', async () => {
  const env = envWith();
  await env.LIVE.put('field:places', JSON.stringify([{ id: 'n1', name: 'Jallo Park', lat: 31.5, lon: 74.3, radius: 150 }]));
  await env.LIVE.put('field:assign', JSON.stringify({ 'TST-1': { name: 'Test Ranger', places: ['n1'] }, 'TST-2': { places: ['n1'] } }));
  const trail = { v: { 'TST-1': parked(31.55, 74.35, -20, 0), 'TST-2': parked(31.5003, 74.3002, -40, 0) } };
  let opened = await detect(env, trail, MON10);
  assert.deepEqual(opened.map((x) => x.reg), ['TST-1']); assert.equal(opened[0].name, 'Test Ranger');
  opened = await detect(env, trail, MON10 + 60000); assert.equal(opened.length, 0, 'same stop is not reported twice');
  assert.equal((await detect(env, { v: { 'TST-1': parked(31.55, 74.35, -10, 0) } }, MON10)).length, 0, 'shorter than the limit');
});

test('staff phone: pass links to one bike, sees only its alerts, answers with a voice note; owner sees it; escalation', async () => {
  const env = envWith();
  const owner = ck(await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '4321' } }));
  const made = await (await call(env, '/api/gate/staff-pass', { method: 'POST', cookie: owner, body: { name: 'Test Ranger', reg: 'TST-1' } })).json();
  const enter = await call(env, '/api/gate/enter', { method: 'POST', body: { code: made.code } });
  assert.equal((await enter.json()).staff, true);
  const phone = ck(enter);
  assert.equal((await call(env, '/api/fleet.json', { cookie: phone })).status, 403, 'staff cannot see the owner data');
  assert.equal((await call(env, '/staff', { cookie: phone })).status, 200);
  assert.equal((await call(env, '/staff', { cookie: owner })).status, 401, 'the staff page is for staff phones');
  await env.LIVE.put('field:places', JSON.stringify([{ id: 'n1', lat: 31.5, lon: 74.3, radius: 150 }]));
  await env.LIVE.put('field:assign', JSON.stringify({ 'TST-1': { places: ['n1'] }, 'TST-9': { places: ['n1'] } }));
  await detect(env, { v: { 'TST-1': parked(31.55, 74.35, -20, 0), 'TST-9': parked(31.6, 74.4, -20, 0) } }, MON10);
  let st = await (await call(env, '/api/me/state', { cookie: phone })).json();
  assert.equal(st.open.length, 1); assert.equal(st.open[0].reg, 'TST-1');
  // no answer: escalates after answerMin
  await buzzTick(env, MON10 + 11 * 60000);
  st = await (await call(env, '/api/me/state', { cookie: phone })).json(); assert.equal(st.open[0].escalated, true);
  assert.equal((await call(env, '/api/me/answer/' + st.open[0].id + '?reason=tea', { method: 'POST', cookie: phone, body: { text: '' } })).status, 400, 'needs a voice note or text');
  const audio = new Uint8Array([1, 2, 3, 4]).buffer;
  const ans = await call(env, '/api/me/answer/' + st.open[0].id + '?reason=puncture', { method: 'POST', cookie: phone, body: audio, type: 'audio/webm' });
  const a = await ans.json(); assert.equal(a.incident.status, 'answered'); assert.equal(a.incident.answer.audio, true); assert.equal(a.incident.answer.late, true);
  const inc = await (await call(env, '/api/field/incidents?reg=TST-1', { cookie: owner })).json();
  assert.equal(inc.incidents[0].answer.reason, 'puncture');
  const rec = await call(env, '/api/field/rec/' + st.open[0].id, { cookie: owner });
  assert.equal(rec.status, 200); assert.equal(rec.headers.get('Content-Type'), 'audio/webm');
  assert.equal((await call(env, '/api/field/rec/' + st.open[0].id, { cookie: phone })).status, 403, 'staff cannot browse recordings');
  const rv = await (await call(env, '/api/field/review', { method: 'POST', cookie: owner, body: { id: st.open[0].id, review: 'accepted' } })).json();
  assert.equal(rv.incident.review, 'accepted');
  // cancelling the pass unlinks the phone
  await call(env, '/api/gate/staff-revoke', { method: 'POST', cookie: owner, body: { id: made.staffPasses[0].id } });
  assert.equal((await call(env, '/api/me/state', { cookie: phone })).status, 403);
});
