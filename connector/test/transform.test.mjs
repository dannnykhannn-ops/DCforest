/* Synthetic data only (made-up registrations), shaped like the portal's real frames. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, buildSnapshot, validateSnapshot } from '../src/transform.js';
import worker, { sync } from '../src/worker.js';
import { memoryKV } from '../scripts/env.mjs';

const NOW = Date.parse('2026-11-16T08:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const veh = (reg, data) => ({ imei: 'x' + reg, registration_no: reg, attribute: null, data });
const fix = { lat: '31.5', lon: '74.3' };

const ITEMS = [
  veh('TST-0001', { ...fix, ts: ago(1), speed_kph: '18', ignition: '1', gsm_signal: '100' }),   // moving, strong
  veh('TST-0002', { ...fix, ts: ago(2), speed_kph: '0', ignition: '1', gsm_signal: '75' }),     // idle, strong
  veh('TST-0003', { ...fix, ts: ago(3), speed_kph: '0', ignition: '0', gsm_signal: '4' }),      // stop, weak (portal rule: < 10)
  veh('TST-0004', { ...fix, ts: ago(5), speed_kph: '2', ignition: '0' }),                       // stop, signal not reported
  veh('TST-0005', { is_active: false }),                                                        // never reported -> offline
  veh('TST-0006', { ...fix, ts: ago(2881), speed_kph: '40', ignition: '1', gsm_signal: '100' }),// older than 48 h -> offline
  veh('TST-0007', { ...fix, ts: ago(1400), speed_kph: '24', ignition: '1', gsm_signal: '100' }),// 23 h old but portal still says moving
  veh('TST-0008', { lat: '0', lon: '0', ts: ago(1), speed_kph: '0', ignition: '0', gsm_signal: '25' }), // stop, low, no GPS
  veh('TST-0009', { ...fix, ts: ago(1), speed_kph: '0' }),                                      // ignition unknown -> idle (portal fallback)
];

test('classification mirrors the portal rules', () => {
  const s = (i) => classify(ITEMS[i], NOW);
  assert.deepEqual([s(0).state, s(0).signal], ['moving', 'strong']);
  assert.deepEqual([s(1).state, s(1).signal], ['idle', 'strong']);
  assert.deepEqual([s(2).state, s(2).signal, s(2).weak], ['stop', 'weak', true]);
  assert.deepEqual([s(3).state, s(3).signal], ['stop', null]);          // missing signal stays missing, not "strong"
  assert.deepEqual([s(4).state, s(4).signal], ['none', 'none']);
  assert.equal(s(5).state, 'none');
  assert.equal(s(6).state, 'moving');
  assert.deepEqual([s(7).signal, s(7).noGps], ['low', true]);
  assert.equal(s(8).state, 'idle');
});

test('summary adds up and exposes only reg/state/signal', () => {
  const snap = buildSnapshot(ITEMS, NOW);
  assert.deepEqual(snap.summary, { total: 9, moving: 2, idle: 2, stopped: 3, weakGsm: 1, offline: 2, noGps: 1 });
  const s = snap.summary;
  assert.equal(s.moving + s.idle + s.stopped + s.offline, s.total);
  for (const v of snap.vehicles) assert.deepEqual(Object.keys(v), ['reg', 'state', 'signal']);
  assert.ok(!JSON.stringify(snap).includes('31.5'), 'coordinates must not leave the connector');
});

test('bad snapshots are rejected', () => {
  assert.throws(() => validateSnapshot([], 0), /no vehicles/);
  assert.throws(() => validateSnapshot(ITEMS, 12), /declared 12/);
  assert.throws(() => validateSnapshot([ITEMS[0], ITEMS[0]], 2), /duplicate/);
  assert.throws(() => validateSnapshot([{ data: {} }], 1), /registration_no/);
  assert.throws(() => validateSnapshot(ITEMS.slice(0, 4), 4, 43), /fell from 43/);
  assert.doesNotThrow(() => validateSnapshot(ITEMS, 9, 9));
});

test('a failed sync keeps the last good snapshot and reports it as stale', async () => {
  const good = buildSnapshot(ITEMS, Date.now() - 20 * 60000);              // 20 minutes old
  const env = { LIVE: memoryKV({ 'live:latest': JSON.stringify(good), 'gate:config': '{"open":true}' }), STALE_AFTER_SECONDS: '900' };  // no PORTAL_TOKEN
  const result = await sync(env);
  assert.deepEqual(result, { ok: false, error: 'auth' });

  const res = await worker.fetch(new Request('http://x/api/live.json'), env);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.summary, good.summary);                             // numbers untouched
  assert.equal(body.fetchedAt, good.fetchedAt);                             // still the last successful time
  assert.equal(body.stale, true);
  assert.equal(body.lastError, 'auth');
});

test('with no snapshot at all the API says unavailable instead of zeros', async () => {
  const env = { LIVE: memoryKV({ 'gate:config': '{"open":true}' }) };
  const res = await worker.fetch(new Request('http://x/api/live.json'), env);
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.available, false);
  assert.equal(body.summary, undefined);
});
