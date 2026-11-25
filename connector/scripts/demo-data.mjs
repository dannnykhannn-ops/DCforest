/* DEMO data for the local preview only: made-up positions around Lahore for the site's own
   registrations, with trails since 8 am. Never used by the deployed Worker. */
import { buildSnapshot, buildPositions, appendTrail, pkDate } from '../src/transform.js';

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const BASES = [[31.5204, 74.3587], [31.4697, 74.2728], [31.5497, 74.3436], [31.4504, 74.4071], [31.5826, 74.3080], [31.3889, 74.2311]];

function vehicleAt(reg, i, t, dayStart) {
  const r = rng(i * 7919 + 13);
  const [bLat, bLon] = BASES[Math.floor(r() * BASES.length)];
  const home = [bLat + (r() - 0.5) * 0.02, bLon + (r() - 0.5) * 0.02];
  const kind = i % 9 === 0 ? 'offline' : i % 4 === 0 ? 'mover' : i % 13 === 5 ? 'idle' : 'parked';
  if (kind === 'offline') {
    return { imei: 'demo' + i, registration_no: reg, data: { lat: home[0], lon: home[1], ts: new Date(dayStart - (3 + i % 4) * 86400000).toISOString(), speed_kph: 0, ignition: 0, gsm_signal: 40 } };
  }
  const mins = Math.max(0, (t - dayStart) / 60000);
  let lat = home[0], lon = home[1], speed = 0, ign = kind === 'idle' ? 1 : 0;
  if (kind === 'mover') {
    const hd = r() * Math.PI * 2, loop = 90 + r() * 120;   // drives out and back every 1.5-3.5 hours
    const phase = (mins % loop) / loop, dist = Math.sin(phase * Math.PI) * (0.03 + r() * 0.05);
    lat += Math.cos(hd + phase) * dist; lon += Math.sin(hd + phase) * dist;
    speed = phase > 0.05 && phase < 0.95 ? Math.round(18 + r() * 30) : 0; ign = speed ? 1 : 0;
  }
  return { imei: 'demo' + i, registration_no: reg,
    data: { lat: +lat.toFixed(6), lon: +lon.toFixed(6), ts: new Date(t - 30000).toISOString(), speed_kph: speed, ignition: ign, gsm_signal: i % 7 === 3 ? 6 : 31 + (i % 30) } };
}

/** Fills the in-memory KV with a demo snapshot and today's demo trail. */
export async function seedDemo(env, regs, now = Date.now()) {
  const date = pkDate(now);
  const dayStart = Date.parse(date + 'T08:00:00+05:00');
  let trail = null;
  for (let t = Math.min(dayStart, now); t <= now; t += 5 * 60000) {
    trail = appendTrail(trail, buildPositions(regs.map((g, i) => vehicleAt(g, i, t, dayStart)), t), date);
  }
  const items = regs.map((g, i) => vehicleAt(g, i, now, dayStart));
  const snap = buildSnapshot(items, now, 'DEMO data (not from the portal)');
  snap.positions = buildPositions(items, now);
  snap.demo = true;
  await env.LIVE.put('live:latest', JSON.stringify(snap));
  await env.LIVE.put('trail:' + date, JSON.stringify(trail));
}
