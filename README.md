# Video Sync Controller

A small real-time system where one **Controller** manages synchronized video playback across multiple **Display** clients.

The coordination server is the authoritative source of playback state. Displays report their local position every second; the Controller shows per-display drift; each Display automatically corrects itself when drift grows.

## Architecture

```
Browser tabs                     Node process
─────────────                    ────────────
/controller  ──controller:command──►  Express + Socket.IO
/display/:id ◄──session:state────────  in-memory session
             ──display:status──────►  expected position + telemetry
```

**Why this shape**

| Choice | Reason |
|--------|--------|
| React + Vite + Express + Socket.IO | Fits the problem with minimal ceremony; Socket.IO gives reconnects and acknowledgements for free |
| Separate `/controller` and `/display/:id` routes | Multiple displays = multiple tabs; no extra process per screen |
| Server-authoritative state | All clients share one truth; controller commands bump a `version` |
| In-memory session | Enough for a local demo / single-instance deploy; no DB required |
| Production: Express serves `client/dist` | One URL to deploy and demo |

Not chosen: Next.js (SSR adds little here), WebRTC (overkill for control messages), Redis (unnecessary for one session).

## Sample videos

Clips live in `client/public/videos/` and are served same-origin (`/videos/...`).

## Quick start (local)

```bash
# install
npm run install:all

# terminal 1
npm run dev:server

# terminal 2
npm run dev:client
```

Open:

- Home: http://localhost:5173/
- Controller: http://localhost:5173/controller
- Display A: http://localhost:5173/display/screen-1
- Display B: http://localhost:5173/display/screen-2

Or use **Open New Display** on the home page.

## Authoritative playback position

The server stores an **anchor**, not a continuously ticking clock:

```
positionAtLastUpdate  // seconds
updatedAt             // wall-clock ms when that position was set
isPlaying
version               // increments only on controller commands
```

**Expected position**

```
paused  → positionAtLastUpdate
playing → positionAtLastUpdate + (now - updatedAt) / 1000
```

On every command (`play`, `pause`, `seek`, `restart`, `select-video`) the server freezes the current expected position into `positionAtLastUpdate`, sets a new `updatedAt`, and increments `version`. Displays apply a new version immediately; status-only updates do **not** bump `version`.

## Drift and correction

```
driftMs = (display.currentTime - expectedPosition) * 1000
```

Shown on the Controller for every connected display.

Each Display corrects itself every telemetry tick (~1s):

| Condition | Action |
|-----------|--------|
| \|drift\| ≤ 120 ms | Treat as normal jitter; keep `playbackRate = 1` |
| 120–500 ms | Soft correction: `playbackRate = 1.05` (behind) or `0.95` (ahead) |
| \|drift\| > 500 ms | Hard seek to expected position |

Hard seeks have a **2s cooldown** so a slow network or buffering does not thrash seeks. Thresholds are intentionally visible in the diagnostics panel so the strategy is easy to demo and discuss.

## Socket protocol

| Event | Direction | Purpose |
|-------|-----------|---------|
| `controller:register` | client → server | Mark socket as controller |
| `controller:command` | client → server | `{ type, ... }` with ack `{ ok, error? }` |
| `display:register` | client → server | `{ displayId }` |
| `display:status` | client → server | `{ position, playbackState }` every 1s |
| `session:state` | server → clients | Full authoritative session (commands / joins) |
| `displays:update` | server → clients | Telemetry only (no version bump) |
| `session:request` | client → server | Resync after connect |

## Production / deploy

Build the client, then run the server with `NODE_ENV=production` so it serves the built SPA:

```bash
npm run install:all
npm run build
NODE_ENV=production PORT=3001 npm start
```

App: http://localhost:3001/

### Render (Web Service)

| Setting | Value |
|---------|-------|
| Build Command | `npm run install:all && npm run build` |
| Start Command | `npm start` |
| `NODE_ENV` | `production` |

`install:all` uses `--include=dev` for the client so Vite still installs when Render sets `NODE_ENV=production` during the build.


**Done (core assignment)**

- Controller: select / play / pause / seek / restart
- Multiple identifiable displays with live telemetry
- Server-authoritative state + versioned commands
- Drift calculation on Controller and Displays
- Automatic correction (rate nudge + hard seek)
- On-screen diagnostics


## Project layout

```
client/          React + Vite UI
  src/pages/     Home, Controller, Display
  src/lib/       socket + shared time helpers
server/
  index.js       Entire coordination layer (~220 lines)
```

Keep the server in one file on purpose: the whole state machine fits on one screen and is easy to walk through in an interview.
