# DC Forest – Daily Activity Tracker

Website for the Publicity and Extension Division, Lahore, with live fleet numbers from the vehicle
tracking portal and an owner-only area (dashboard, live map, alerts, activity log, reports).

Live address: https://dcforest.vercel.app (Vercel forwards everything to the Cloudflare Worker).

## What is where

| Folder / file | What it is |
|---|---|
| `site-v19-extracted/forest-tracker-site/index.html` | The public page (classic design). The **DAILY DATA** block inside it is the staff list: update it by hand when staff change. |
| `site-v19-extracted/forest-tracker-site/dashboard.html` | Owner dashboard (`/dashboard`): fleet, staffing, alerts, activity log, reports, staff directory. Also the public home page when the site design is set to **New**. |
| `site-v19-extracted/forest-tracker-site/control.html` | Control Room (`/control`): live map, people, today's routes. Owner only. |
| `site-v19-extracted/forest-tracker-site/assets/v2/` | Images for the new design (cut from the supplied asset sheets). |
| `site-v19-extracted/forest-tracker-site/sw.js` | Offline support. Bump `VERSION` when you change files so installed apps update. |
| `connector/` | Cloudflare Worker: portal sync every 5 minutes, access gate (PIN, passes), design switch, all `/api/*` data. Tests: `npm test`. Details in `connector/README.md`. |
| `vercel.json`, `vercel-upload/` | Make dcforest.vercel.app show the Worker. |

## Pages and who can open them

| Address | Who |
|---|---|
| `/` | Everyone with access (pass, or site opened to everyone). Classic page, or the new design when switched to **New**. |
| `/classic` | Same people; always the classic page. |
| `/gate` (the ∞ box) | Entry page; owner panel after the PIN: passes, open/private, **site design Classic / New**, sign everyone out, links to the dashboard and Control Room. |
| `/dashboard`, `/control` | Owner (PIN) and reviewers, even when the site is open to everyone. |

**Reviewers:** in the owner panel, *Reviewers → Create reviewer pass* (with their name). The pass works once; that device then has reviewer access for 30 days until you cancel it. Reviewers see everything the owner sees and can pin notes on any screen (Notes button, bottom left), but cannot change settings. Notes are kept in KV (`notes`); the owner can mark them done or delete them.
| `/api/live.json` | Public numbers (no locations or times). |
| `/api/fleet.json`, `/api/trail.json`, `/api/activity.json`, `/api/report.json` | Owner only: positions, routes, activity, reports. |

## Publishing

Pushing to `main` publishes automatically (Cloudflare Workers Builds, root directory `connector`,
command `npx wrangler deploy`). Work on another branch and merge to `main` when ready.

## Not in this repository (on purpose)

| Item | Where it lives | Needed for |
|---|---|---|
| `PORTAL_TOKEN` (portal login, renew about every 30 days) | Cloudflare secret | Live numbers |
| `ADMIN_PIN` (owner PIN) | Cloudflare secret | Owner panel and owner pages |
| `SESSION_SECRET` | Cloudflare secret | Signing everyone's access sessions |
| Live data: last snapshot, daily routes (kept 31 days), passes, open/private, site design | Cloudflare KV namespace `LIVE` (id in `connector/wrangler.jsonc`) | Running site |
| The Cloudflare account (Worker `dc-forest-live`, its KV, Workers Builds link to this repo) | dash.cloudflare.com | Deploys, secrets, logs |
| The Vercel project behind dcforest.vercel.app | vercel.com | The public address |
| Original asset sheets (`NEW ASSETS 24 NOVP`) and portal network captures (HAR) | Your computer only | Not needed to run; never commit HAR files (they contain login tokens) |

## Working from another computer

1. Clone: `git clone https://github.com/dannnykhannn-ops/DCforest.git`
2. Install Node.js 20 or newer, then in `connector/`: `npm install`
3. Preview without any secrets: `npm run dev -- --demo` → http://localhost:8787 (made-up data; owner PIN `0000` locally)
4. Preview with real numbers: copy `connector/.dev.vars.example` to `.dev.vars` and paste a portal token (the file explains how), then `npm run dev`
5. Run the checks: `npm test`
6. Publish: commit and push to `main`. To change secrets: `npx wrangler login`, then `npx wrangler secret put NAME`.
