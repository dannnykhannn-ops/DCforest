/* Portal snapshot -> public site snapshot.
   Pure functions, no I/O, so the same code runs in the Worker, in Node tests and in the dry run.

   The status rules below are a line-for-line port of the portal's own classifier
   (function `tt` / `ew` in its dashboard bundle, read on 16 Nov 2026), so the numbers
   match the portal's "Fleet summary" card. Where the portal's rule looks questionable it
   is still mirrored and called out in README.md, because the goal is parity with the portal. */

export const OFFLINE_AFTER_MIN = 2880;   // portal: no report for 48 h => offline
export const MOVING_MIN_KPH = 3;         // portal: speed >= 3 km/h => moving
export const STATES = ['moving', 'idle', 'stop', 'none'];

/** First finite number among the arguments; numeric strings are accepted. Never returns 0 for "missing". */
function num(...xs) {
  for (const x of xs) {
    if (x === null || x === undefined || x === '') continue;
    const n = typeof x === 'string' ? Number(x) : x;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function ignition(d) {
  const v = d.ignition ?? d.ign ?? d.engine_on ?? d.acc ?? null;
  const s = String(v).toLowerCase();
  if (v === true || v === 1 || s === '1' || s === 'true' || s === 'on') return 'on';
  if (v === false || v === 0 || s === '0' || s === 'false' || s === 'off') return 'off';
  return null;
}

/** Classify one portal item. `now` is epoch ms. */
export function classify(item, now) {
  const d = (item && item.data) || {};
  const h = d.health || {};
  const active = item.is_active !== false;
  const tsRaw = active ? (d.timestamp_iso || d.ts || d.time || d.gps_datetime || null) : null;
  const tsMs = tsRaw ? Date.parse(tsRaw) : NaN;
  const ageMin = Number.isFinite(tsMs) ? (now - tsMs) / 60000 : Infinity;

  if (!active || !tsRaw || !(ageMin <= OFFLINE_AFTER_MIN)) {
    return { state: 'none', signal: 'none', weak: false, noGps: false };
  }

  const speed = num(d.speed_kph, d.speed, d.gps && d.gps.speed_kph);
  const ign = ignition(d);
  const state = speed !== null && speed >= MOVING_MIN_KPH ? 'moving'
    : ign === 'on' ? 'idle'
    : ign === 'off' ? 'stop'
    : 'idle';                                   // portal falls back to idle when ignition is unknown

  // Signal: the portal reads `gsm_signal`, treats values <= 5 as bars and larger values as a 0-63 scale.
  const gsm = num(d.gsm_signal, h.gsm_signal);
  let signal = null, weak = false;              // null = the tracker did not report a signal value
  if (gsm !== null) {
    const bars = gsm <= 5 ? gsm : Math.round(gsm / 63 * 5);
    weak = bars <= 1 || gsm < 10;               // portal's "Weak GSM" rule, mirrored as-is
    signal = weak ? 'weak' : bars <= 2 ? 'low' : 'strong';
  }

  // No GPS: reporting, but without a usable position (same validity test the portal uses for map points).
  const lat = num(d.lat, d.latitude, d.latitude_dd, d.gps && d.gps.lat);
  const lon = num(d.lon, d.longitude, d.longitude_dd, d.gps && d.gps.lon);
  const noGps = lat === null || lon === null || (lat === 0 && lon === 0);

  return { state, signal, weak, noGps };
}

/** Throws a descriptive Error if the portal message is not a usable full snapshot. */
export function validateSnapshot(items, declaredCount, previousTotal) {
  if (!Array.isArray(items)) throw new Error('validation: items is not an array');
  if (items.length === 0) throw new Error('validation: snapshot has no vehicles');
  if (Number.isFinite(declaredCount) && declaredCount !== items.length) {
    throw new Error(`validation: portal declared ${declaredCount} vehicles but sent ${items.length}`);
  }
  const seen = new Set();
  for (const it of items) {
    const reg = it && it.registration_no;
    if (typeof reg !== 'string' || !reg.trim()) throw new Error('validation: vehicle without registration_no');
    if (seen.has(reg)) throw new Error(`validation: duplicate registration ${reg}`);
    seen.add(reg);
    if (it.data !== undefined && (it.data === null || typeof it.data !== 'object')) {
      throw new Error(`validation: ${reg} has malformed data`);
    }
  }
  // A fleet that suddenly halves is far more likely a partial feed than reality: keep the old snapshot.
  if (Number.isFinite(previousTotal) && previousTotal > 0 && items.length < previousTotal / 2) {
    throw new Error(`validation: vehicle count fell from ${previousTotal} to ${items.length}`);
  }
}

/** Build the snapshot the website consumes. Only registration, state and signal leave the connector:
    no coordinates, speeds, IMEIs or timestamps per vehicle. */
export function buildSnapshot(items, now, source = 'Vehicle tracking portal') {
  const vehicles = [];
  const summary = { total: items.length, moving: 0, idle: 0, stopped: 0, weakGsm: 0, offline: 0, noGps: 0 };
  for (const it of items) {
    const c = classify(it, now);
    vehicles.push({ reg: it.registration_no.trim(), state: c.state, signal: c.signal });
    if (c.state === 'moving') summary.moving++;
    else if (c.state === 'idle') summary.idle++;
    else if (c.state === 'stop') summary.stopped++;
    else summary.offline++;
    if (c.weak) summary.weakGsm++;
    if (c.noGps) summary.noGps++;
  }
  return { schema: 1, source, fetchedAt: new Date(now).toISOString(), summary, vehicles };
}

/* ---------------------------------------------------------------------------
   Control Room (owner only). Positions and trails never go into /api/live.json;
   they are served only to an owner session by /api/fleet.json and /api/trail.json.
--------------------------------------------------------------------------- */

const PK_OFFSET_MS = 5 * 3600000;                 // Pakistan Standard Time, UTC+5, no daylight saving
export const TRAIL_MAX_JUMP_KPH = 150;            // a hop faster than this between reports is a GPS glitch, not travel

/** Calendar date in Pakistan for an epoch-ms instant, as YYYY-MM-DD. */
export function pkDate(ms) { return new Date(ms + PK_OFFSET_MS).toISOString().slice(0, 10); }

/** Last reported position and readings of one portal item, whether or not it is offline now.
    Missing values stay null; a 0,0 position counts as no position. */
export function position(item) {
  const d = (item && item.data) || {};
  const lat = num(d.lat, d.latitude, d.latitude_dd, d.gps && d.gps.lat);
  const lon = num(d.lon, d.longitude, d.longitude_dd, d.gps && d.gps.lon);
  const ok = lat !== null && lon !== null && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const tsRaw = d.timestamp_iso || d.ts || d.time || d.gps_datetime || null;
  const tsMs = tsRaw ? Date.parse(tsRaw) : NaN;
  return {
    lat: ok ? lat : null,
    lon: ok ? lon : null,
    speed: num(d.speed_kph, d.speed, d.gps && d.gps.speed_kph),
    ignition: ignition(d),
    reportedAt: Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : null,
  };
}

/** Owner-only per-vehicle list: registration, status and last known position. */
export function buildPositions(items, now) {
  return items.map((it) => {
    const c = classify(it, now);
    return { reg: it.registration_no.trim(), state: c.state, signal: c.signal, ...position(it) };
  });
}

/** Adds each vehicle's newest report to the day's trail. Pure: returns a new trail object.
    trail = { date, v: { REG: [[epochSeconds, lat, lon, speedOrNull], ...] } }
    A point is added only when it has a position, is newer than the last point, and was reported on `date`. */
export function appendTrail(trail, positions, date) {
  const out = { date, v: { ...((trail && trail.date === date && trail.v) || {}) } };
  for (const p of positions) {
    if (p.lat === null || p.lon === null || !p.reportedAt) continue;
    const t = Math.floor(Date.parse(p.reportedAt) / 1000);
    if (pkDate(t * 1000) !== date) continue;
    const pts = out.v[p.reg] || [];
    const last = pts[pts.length - 1];
    if (last && t <= last[0]) continue;
    out.v[p.reg] = [...pts, [t, +p.lat.toFixed(6), +p.lon.toFixed(6), p.speed === null ? null : Math.round(p.speed)]];
  }
  return out;
}

/** Great-circle distance in metres. */
export function metres(aLat, aLon, bLat, bLon) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance along a trail in km, skipping impossible jumps. Returns null when there are fewer than 2 points. */
export function trailKm(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    const [t0, a0, o0] = pts[i - 1], [t1, a1, o1] = pts[i];
    const d = metres(a0, o0, a1, o1), hours = Math.max(1, t1 - t0) / 3600;
    if (d / 1000 / hours <= TRAIL_MAX_JUMP_KPH) m += d;
  }
  return Math.round(m / 100) / 10;
}
