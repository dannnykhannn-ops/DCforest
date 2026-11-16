import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { memoryKV } from '../scripts/env.mjs';

const SITE = 'THE-REAL-SITE';
const newEnv = (extra = {}) => ({
  LIVE: memoryKV(), ADMIN_PIN: '4321', SESSION_SECRET: 'test-secret-test-secret-test', GUEST_SESSION_MINUTES: '30',
  ASSETS: { fetch: async () => new Response(SITE) }, ...extra,
});
const call = (env, path, { method = 'GET', body, cookie } = {}) => worker.fetch(new Request('http://x' + path, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
}), env);
const cookieOf = (res) => (res.headers.get('Set-Cookie') || '').split(';')[0];
async function ownerCookie(env) { return cookieOf(await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '4321' } })); }
async function newPass(env, owner) { return (await (await call(env, '/api/gate/pass', { method: 'POST', cookie: owner })).json()).code; }

test('without a session the site and its data are not served', async () => {
  const env = newEnv();
  const home = await call(env, '/');
  assert.equal(home.status, 401);
  assert.ok(!(await home.text()).includes(SITE));
  assert.equal((await call(env, '/index.html')).status, 401);
  assert.equal((await call(env, '/README.txt')).status, 401);
  assert.equal((await call(env, '/api/live.json')).status, 401);
  assert.equal((await call(env, '/assets/forest-bg.webp')).status, 200);       // images only
  assert.equal((await call(env, '/api/gate/state')).status, 403);
  assert.equal((await call(env, '/api/gate/pass', { method: 'POST' })).status, 403);
});

test('a one-time pass works exactly once', async () => {
  const env = newEnv();
  const owner = await ownerCookie(env);
  const code = await newPass(env, owner);
  assert.match(code, /^[A-Z2-9]{6}$/);

  const first = await call(env, '/api/gate/enter', { method: 'POST', body: { code: code.slice(0, 3).toLowerCase() + '-' + code.slice(3) } });
  assert.equal(first.status, 200);
  assert.match(first.headers.get('Set-Cookie'), /Max-Age=1800;?|Max-Age=1800$/);  // 30 minutes
  const visitor = cookieOf(first);
  assert.equal(await (await call(env, '/', { cookie: visitor })).text(), SITE);

  const second = await call(env, '/api/gate/enter', { method: 'POST', body: { code } });
  assert.equal(second.status, 401);
  // a visitor cannot manage passes
  assert.equal((await call(env, '/api/gate/pass', { method: 'POST', cookie: visitor })).status, 403);
});

test('visitor access ends after 30 minutes', async (t) => {
  const env = newEnv();
  const code = await newPass(env, await ownerCookie(env));
  const visitor = cookieOf(await call(env, '/api/gate/enter', { method: 'POST', body: { code } }));
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  Date.now = () => realNow() + 29 * 60000;
  assert.equal((await call(env, '/', { cookie: visitor })).status, 200);
  Date.now = () => realNow() + 31 * 60000;
  assert.equal((await call(env, '/', { cookie: visitor })).status, 401);
});

test('wrong PIN locks after 5 tries; a tampered session is rejected', async () => {
  const env = newEnv();
  for (let i = 0; i < 5; i++) assert.equal((await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '0000' } })).status, 401);
  const locked = await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '4321' } });   // even the right PIN waits
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).minutes, 30);

  const env2 = newEnv();
  const owner = await ownerCookie(env2);
  const forged = owner.replace(/=([^.]+)\./, (m, b) => '=' + btoa(JSON.stringify({ r: 'admin', g: 1, e: Date.now() + 9e9 })).replace(/=+$/, '') + '.');
  assert.equal((await call(env2, '/api/gate/state', { cookie: forged })).status, 403);
});

test('cancel, sign everyone out, and open-to-everyone', async () => {
  const env = newEnv();
  let owner = await ownerCookie(env);
  const cancelled = await newPass(env, owner);
  await call(env, '/api/gate/revoke', { method: 'POST', cookie: owner, body: { code: cancelled } });
  assert.equal((await call(env, '/api/gate/enter', { method: 'POST', body: { code: cancelled } })).status, 401);

  const code = await newPass(env, owner);
  const visitor = cookieOf(await call(env, '/api/gate/enter', { method: 'POST', body: { code } }));
  await call(env, '/api/gate/signout', { method: 'POST', cookie: owner });
  assert.equal((await call(env, '/', { cookie: visitor })).status, 401);
  assert.equal((await call(env, '/api/gate/state', { cookie: owner })).status, 403);

  owner = await ownerCookie(env);
  await call(env, '/api/gate/open', { method: 'POST', cookie: owner, body: { open: true } });
  assert.equal(await (await call(env, '/')).text(), SITE);
  await call(env, '/api/gate/open', { method: 'POST', cookie: owner, body: { open: false } });
  assert.equal((await call(env, '/')).status, 401);
});

test('if the secrets are missing the gate stays shut', async () => {
  const env = newEnv({ ADMIN_PIN: '', SESSION_SECRET: '' });
  assert.equal((await call(env, '/')).status, 401);
  assert.equal((await call(env, '/api/gate/admin', { method: 'POST', body: { pin: '' } })).status, 503);
});
