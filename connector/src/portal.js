/* Reads one full fleet snapshot from the portal's live feed.

   Verified on 16 Nov 2026 against the portal's own dashboard code and traffic:
   - the dashboard opens  wss://nevigo-socket.vtssmartsolutions.com/?token=<JWT>&imei=all
   - the first frame is a zlib-deflated JSON message  {type:"snapshot_all", count, items:[...]}
     (larger fleets may arrive as "snapshot_all_page" frames instead)
   - the JWT is the one GET https://nevigo-backend.vtssmartsolutions.com/auth/me returns
     for a signed-in user; it is valid for 30 days.
   This is the feed the dashboard itself uses. It is not a documented public API. */

const SOCKET_URL = 'wss://nevigo-socket.vtssmartsolutions.com/';

/** Decode a JWT payload without verifying it (we only read `exp`). Returns null if it is not a JWT. */
export function tokenInfo(token) {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { expiresAt: typeof p.exp === 'number' ? p.exp * 1000 : null };
  } catch { return null; }
}

async function inflate(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).text();
}

/** Resolves with {items, count}. Rejects with an Error whose message starts with
    "auth:", "network:" or "validation:" so callers can report the failure class. */
export function fetchFleetSnapshot(token, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, pages = [], declared = null, quiet = null, ws;
    const finish = (err, val) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(quiet);
      try { ws.close(1000, 'done'); } catch {}
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('network: no snapshot within ' + timeoutMs + ' ms')), timeoutMs);

    try {
      ws = new WebSocket(SOCKET_URL + '?token=' + encodeURIComponent(token) + '&imei=all');
    } catch (e) { return finish(new Error('network: ' + e.message)); }
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('error', () => finish(new Error('network: websocket error')));
    ws.addEventListener('close', (e) => {
      // Closed before any snapshot arrived. 1008/4401/4403 are the usual "policy/unauthorised" codes.
      const authish = e.code === 1008 || e.code === 4401 || e.code === 4403;
      // Give a frame that is still being unpacked a moment to finish first.
      setTimeout(() => finish(new Error((authish ? 'auth' : 'network') +': socket closed before snapshot (code ' + e.code + (e.reason ? ', ' + e.reason : '') + ')')), 500);
    });
    ws.addEventListener('message', async (ev) => {
      try {
        if (typeof ev.data === 'string') return;                       // the feed is binary; ignore anything else
        const msg = JSON.parse(await inflate(ev.data));
        if (msg.type === 'snapshot_all') {
          return finish(null, { items: msg.items, count: Number(msg.count) });
        }
        if (msg.type === 'snapshot_all_page') {
          if (msg.first) pages = [];
          if (Array.isArray(msg.items)) pages.push(...msg.items);
          if (Number.isFinite(Number(msg.count))) declared = Number(msg.count);
          const complete = msg.last === true || (declared !== null && pages.length >= declared);
          clearTimeout(quiet);
          if (complete) return finish(null, { items: pages, count: declared ?? NaN });
          // No documented end marker: treat 2 s of silence as the end; the count check then validates it.
          quiet = setTimeout(() => finish(null, { items: pages, count: declared ?? NaN }), 2000);
        }
        // "update"/"update_batch" frames are incremental and are ignored: we only want the full snapshot.
      } catch (e) {
        finish(new Error('validation: unreadable frame (' + e.message + ')'));
      }
    });
  });
}
