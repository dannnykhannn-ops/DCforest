// Offline test of the connector logic with an in-memory KV and fake adapters.
import assert from 'node:assert';
import { sync, validate } from './worker.js';
const kv = new Map(); const env = { SNAP: { get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put: async (k, v) => kv.set(k, v) } };
const good = async () => ({ summary: { total: 43, moving: 2, idle: null, weakGsm: 1, offline: 10, noGps: 0 }, vehicles: [{ reg: 'GAA-5522', state: 'moving', signal: 'strong' }] });
let s = await sync(env, good);
assert.equal(s.summary.moving, 2); assert.equal(s.summary.idle, null, 'missing stays null, not 0'); assert.equal(s.lastError, null);
const ok1 = s.lastSuccessAt;
s = await sync(env, async () => { throw new Error('HTTP 401'); });
assert.equal(s.summary.moving, 2, 'last good numbers kept'); assert.equal(s.lastSuccessAt, ok1); assert.match(JSON.parse(kv.get('live')).lastError, /401/);
s = await sync(env, async () => ({ summary: { total: '43' }, vehicles: 'x' }));
assert.equal(JSON.parse(kv.get('live')).summary.moving, 2, 'invalid response rejected');
assert.ok(validate({ summary: { total: 1, moving: 0, idle: 0, weakGsm: 0, offline: 0, noGps: 0 }, vehicles: [{ reg: 'GAA-1', state: 'x', signal: 'weak' }] }).length);
const env2 = { SNAP: { get: async () => null, put: async () => assert.fail('must not write') } };
await sync(env2, async () => { throw new Error('Source adapter not configured'); });
console.log('connector tests passed');
