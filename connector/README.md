# DC Forest live-fleet connector

Keeps the **Live Fleet** section of the Daily Activity Tracker in step with the vehicle tracking
portal, automatically, every 5 minutes.

```
tracking portal feed ──(every 5 min, server-side)──> connector ──> /api/live.json ──> website
                         token stays here, as a secret      last good snapshot kept
```

The website never contacts the portal and contains no login, token or portal address.

## What was verified (16 Nov 2026)

| Question | Finding |
|---|---|
| Official / documented API? | None found. No API docs, keys or export buttons were seen on the dashboard. |
| What the dashboard itself uses | A WebSocket feed: `wss://nevigo-socket.vtssmartsolutions.com/?token=…&imei=all`. The first frame is a zlib-compressed JSON `snapshot_all` with every vehicle (43 vehicles, about 3.5 KB, arrives in about 0.2 s). |
| Login | Cookie session on `nevigo-backend.vtssmartsolutions.com`. `GET /auth/me` returns a JWT that the feed accepts. The JWT is valid for **30 days** from login. |
| Server's own `status_counts` field | Present in the frame but stale (dated 10 Nov, total 44). **Not used.** The dashboard ignores it too and counts in the browser. |
| Do the connector's numbers match? | Yes. Same snapshot, same moment: portal card 43 / 6 moving / 3 idle / 5 weak GSM / 10 offline; connector 43 / 6 / 3 / 5 / 10. |

Not verified: whether the feed accepts connections from Cloudflare's network (it was tested from a
browser only), and the login request format (so the connector does not log in by itself).

## Metric map

Scope of every number: all vehicles the logged-in portal account can see (`imei=all`), which today is
the 43 motorbikes of Publicity and Extension Division, Lahore. No district filter and no date range:
each value is the vehicle's **latest report** at the time of the sync.

| Site element | Source field(s) in each feed item | Rule (copied from the portal's own code) | Unit |
|---|---|---|---|
| Total vehicles | `items.length` (checked against `count`) | count of vehicles in the snapshot | vehicles |
| Offline | `data.is_active`, `data.ts` | no data, or last report older than 48 hours | vehicles |
| Moving | `data.speed_kph` | not offline and speed ≥ 3 km/h | vehicles |
| Idle | `data.ignition` | not offline, not moving, ignition on (or ignition unknown) | vehicles |
| Stopped (tab only) | `data.ignition` | not offline, not moving, ignition off | vehicles |
| Weak GSM | `data.gsm_signal` | not offline and (bars ≤ 1 or raw value < 10); bars = value if ≤ 5, else value/63×5 | vehicles |
| No GPS | `data.lat`, `data.lon` | not offline and no position, or position 0,0 | vehicles |
| Per-vehicle pill (Moving / Idle / Stopped / Offline) | as above | as above | — |
| Per-vehicle signal bars | `data.gsm_signal` | weak as above; 2 bars = low; otherwise strong; **no value = no bars shown** | — |
| "Last updated" | time of the last successful sync | shown in the viewer's local time | — |

Not synced (still from the daily data block in `index.html`): staff names, posts, duty status,
contacts, and the "Tracker online/offline" chip on each staff card, which comes from the installation
report.

### Three things about the portal's own numbers you should know

The connector reproduces the portal, including these quirks:

1. **Weak GSM is probably over-counted by the portal.** Some trackers report signal as 0–5 bars and
   others as 0–100 %. The portal's "raw value < 10" test marks every bars-type tracker as weak, even at
   4 or 5 bars out of 5. All 5 "weak" vehicles today are of that kind.
2. **"Moving" can be a day old.** A vehicle whose last report (up to 48 h ago) had speed ≥ 3 km/h still
   counts as moving. Two of today's "moving" vehicles last reported 18–24 hours earlier.
3. **No GPS is always 0 on the portal** because its code never fills that list. The connector computes
   it from the position fields instead, so the site may show 1 where the portal shows 0. To show a dash
   instead, set `noGps: null` in `buildSnapshot` (`src/transform.js`).

## Failure behaviour

- A sync that fails, or returns an empty, short, duplicated or malformed snapshot, is discarded.
  The last good snapshot stays in place.
- `/api/live.json` then returns the same numbers with `stale: true` (after 15 minutes) and
  `lastError` set to `auth`, `network` or `validation`.
- The site switches the red LIVE pill to an amber **STALE** pill and the label to
  "Last successful update: …". Numbers are never replaced by zeros; a value the source did not supply
  is shown as "—".
- If the connector itself is unreachable, the site keeps the last snapshot that device received, or
  the daily data block, marked STALE.

## Try it on this computer first (no Cloudflare account needed)

1. Copy `.dev.vars.example` to `.dev.vars` and paste the token (the file explains where to get it).
2. `npm run dry-run` prints the six numbers from a real sync. This is also the test of whether the
   feed accepts a connection that is not a browser.
3. `npm run dev` serves the site with live numbers at http://localhost:8787.
4. `npm test` runs the checks on made-up data.

## Deploy (Cloudflare Workers)

```
npx wrangler login
npx wrangler kv namespace create LIVE        # paste the printed id into wrangler.jsonc
npx wrangler secret put PORTAL_TOKEN         # paste the token when asked
npx wrangler deploy
```

As configured, the Worker also serves the website from the same address. To keep the site on its
current host instead, delete the `assets` block in `wrangler.jsonc`, set `ALLOWED_ORIGIN` to the
site's address, and change `LIVE_URL` in `index.html` to the Worker's full `/api/live.json` address.

## Access gate (private site)

The Worker sends the site and its live numbers only to a browser with a valid session. Images and
icons are the only things served without one. The gate lives in `src/gate.js`; nothing about the PIN
or the passes is in the site's code.

- **Visitor:** enters a one-time pass on the entry page. The pass is used up and that browser gets
  30 minutes of access (`GUEST_SESSION_MINUTES` in `wrangler.jsonc`). An unused pass expires after 7 days.
- **Owner:** clicks the **∞** box (top right of the entry page, or in the site header, or go to `/gate`),
  enters the PIN, and can create or cancel passes, open the site to everyone, make it private again,
  or sign everyone out. The owner session lasts 12 hours.
- **Wrong tries:** 5 wrong PINs, or 5 wrong passes, lock that kind of entry for 30 minutes.
- **Change the PIN:** `npx wrangler secret put ADMIN_PIN`. A longer PIN is safer than 4 digits.
- **dcforest.vercel.app:** the `vercel-upload` folder holds a `vercel.json` that makes that address show
  this Worker, gate included. It is uploaded once; later site changes go out with `npx wrangler deploy`.

## Renewing the login (about every 30 days)

`/api/live.json` includes `authDaysLeft`. When it gets low, or the site turns STALE with
`lastError: "auth"`:

1. Sign in to the portal in a browser.
2. Open `https://nevigo-backend.vtssmartsolutions.com/auth/me` and copy the token value.
3. `npx wrangler secret put PORTAL_TOKEN` and paste it.

## Cost (Cloudflare pricing pages, read 16 Nov 2026)

| Item | Free plan allowance | This connector uses |
|---|---|---|
| Worker requests | 100,000 / day | 288 syncs + one request per site poll |
| Cron triggers | 5 per account, every-minute allowed | 1, every 5 minutes |
| KV writes | 1,000 / day | 288 / day (up to 576 on a day when every sync fails) |
| KV reads | 100,000 / day | 2 per site poll + 288 |
| Static site files | free and unlimited | the site, if hosted on the Worker |
| CPU per run | 10 ms | unpacking 3.5 KB of JSON; expected to fit, **not yet measured on Cloudflare** |

Expected cost: **$0 / month**. If the 10 ms CPU limit turns out to be too tight, the Workers Paid plan
is $5 / month and raises it to 30 s.
