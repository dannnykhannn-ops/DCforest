/* One real sync from this computer, nothing deployed and nothing stored.
   Prints only the six summary numbers and how long the token has left.
     node scripts/dry-run.mjs            (token from connector/.dev.vars) */
import { fetchFleetSnapshot, tokenInfo } from '../src/portal.js';
import { buildSnapshot, validateSnapshot } from '../src/transform.js';
import { readToken } from './env.mjs';

const token = readToken();
if (!token) { console.error('No token. Copy .dev.vars.example to .dev.vars and paste the portal token into it.'); process.exit(1); }

const info = tokenInfo(token);
if (info && info.expiresAt) console.log('Token valid for another', Math.floor((info.expiresAt - Date.now()) / 86400000), 'days');

try {
  const t0 = Date.now();
  const { items, count } = await fetchFleetSnapshot(token);
  validateSnapshot(items, count);
  const snap = buildSnapshot(items, Date.now());
  console.log('Snapshot received in', Date.now() - t0, 'ms');
  console.log('Fetched at:', snap.fetchedAt);
  console.table(snap.summary);
  process.exit(0);
} catch (e) {
  console.error('Sync failed ->', e.message);
  process.exit(2);
}
