# DC Forest – Daily Activity Tracker

Website for the Publicity and Extension Division, Lahore, with its live fleet numbers.

| Folder | What it is |
|---|---|
| `site-v19-extracted/forest-tracker-site/` | The website (single-page app, service worker `tracker-v33`). |
| `connector/` | Cloudflare Worker: syncs the fleet numbers from the tracking portal every 5 minutes, serves `/api/live.json`, and runs the access gate. Has the tests (`npm test`) and its own README. |
| `vercel-upload/`, `vercel.json` | Make dcforest.vercel.app show the Worker. |

Pushing to `main` publishes the site automatically (Cloudflare Workers Builds, root directory `connector`, command `npx wrangler deploy`).

No passwords, tokens or secrets are stored here. The portal token, owner PIN and session secret live only as Cloudflare secrets (`wrangler secret put`), and `connector/.dev.vars` is git-ignored.
