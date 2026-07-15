# BogHopper 🏔️

An endless runner through the Scottish Highlands, built with Three.js.
Race along a gravelly double-track through the moor, hop the peat bogs,
fend off the midges, and stay ahead of the mist — or get swept off the hill.

## Run it

```sh
python3 server.py          # game on http://localhost:8080, PORT env to change
```

`server.py` is stdlib-only (no pip installs): it serves the game, records
anonymous usage events into `boghopper.db` (SQLite, created on first run), and
hosts the usage dashboard at **`/dashboard`** — a hidden-but-public link.

Three.js is vendored in `lib/` — no build step, no network needed. The game
also works from any plain static server (`python3 -m http.server`); the
analytics beacons fail silently when there's no backend.

## Usage dashboard (`/dashboard`)

- Stat tiles: runs today, players today, runs / players / best distance for the
  selected range (7 / 30 / 90 days — the filter scopes everything).
- Charts: unique players per day, runs per day, and a histogram of how far runs
  got before the sweep. Hover or keyboard-focus any bar for exact values; a
  table view of the daily numbers sits below.
- Privacy-light uniques: players are counted by a **daily-rotating salted hash**
  of IP + user agent — no raw IPs or cookies are stored, and yesterday's hash
  can't be linked to today's.
- Auto-refreshes every 60 s. Light and dark mode both supported.

## Deployment

Same pattern as gft-usher-tools / shr-map: push to `main` → GitHub Actions
joins the tailnet → `git push` to the bare repo on the VPS → `post-receive`
hook checks out `/opt/bog-hopper`, installs the systemd unit and restarts.
Caddy terminates TLS and gzips at **boghopper.evangriffiths.org**
(reverse-proxy to `localhost:3003`).

- One-time server setup: `deploy/setup.sh` (run as root from `/opt/bog-hopper`)
- Repo secrets needed for CI: `DEPLOY_SSH_KEY`, `TS_AUTHKEY`
- `boghopper.db` is untracked, so player stats survive deploys
- Caddy's reverse proxy sends `X-Forwarded-For`, which the server uses for
  unique-player counting — don't strip it.

## Controls

| Key | Action |
| --- | --- |
| ← / → (or A / D) | switch track |
| Space / ↑ (or W) | jump — hop out of a bog once your feet unstick |
| S | Smidge® midge spray (collect 🧴 cans on the path) |
| E | eat an oatcake 🥮 — speed, bog-proof feet, and it actively outruns the sweep |
| Esc (or P) | pause, with quit-to-menu |
| R | restart |

## How it plays

- You run at a fixed, slowly ramping speed. Landing in a **peat bog** grabs your
  feet (an instant toll plus a beat where you can't jump), then slows you to a
  squelch; anything that slows you lets **the sweep** (the mist at the base of
  the screen) gain on you. Lost ground recovers slowly — an oatcake is the only
  fast way back. Reach the bottom and you're out.
- The path gets **boggier with distance**; big bogs sometimes have a plank
  line across one lane.
- **Midge swarms** attack periodically — spray them or suffer.
- **Boulders** and wandering **sheep** on the track cost you a stumble.
- A cairn marks every 500 m. Best distance is kept in localStorage.

## Tech notes

- Endless "conveyor belt" of 8 recycled 34 m terrain segments; one continuous
  periodic noise field keeps hillsides seamless across segments and across the
  recycle wrap.
- An Teallach's silhouette (with the Corrag Bhuidhe pinnacles) is a canvas-drawn
  texture on the farthest of three parallax ridge layers.
- Instanced heather/tussocks/rocks, pooled per-segment obstacle meshes,
  ~170 draw calls / ~50 k triangles — comfortably 60 fps on integrated graphics.
- Debug hooks: `window.__bog` (state), `window.__bogStep(dt, n)` (headless
  stepping), `window.__bogGL()` (renderer stats).

Play it live at **https://boghopper.evangriffiths.org**
