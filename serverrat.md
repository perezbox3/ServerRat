# ServerRat Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is one sitting. Write failing tests first where the task is unit-testable, run them red, implement, run them green, then commit. Do not start a task until the previous one is committed and its review gate has passed.

**Goal:** Build serverrat.perezbox3.com — a Rust server finder that surfaces the one thing BattleMetrics and just-wiped.net bury: how a server *holds* population across a wipe cycle. A player filters by wipe schedule, type, group-size, and region, then sees a population curve (avg players day 1/2/3/5/7 post-wipe) so they never join a server that's dead by day 3.

**The user it serves:** A Rust player who has a preferred wipe schedule and play hours, and is sick of joining servers that look alive on wipe day and die by day 3. They want to filter to "Thursday biweekly, 2x, trio-max, US" and see at a glance which servers actually keep their population.

**Architecture:** Thin Node.js ESM backend (`server/`) that proxies the BattleMetrics API, caches responses in SQLite, and computes population curves. It exists primarily to dodge BattleMetrics CORS and to cache (the free tier is rate-limited, and curve computation shouldn't re-hit the API per page load). A vanilla-JS frontend (`public/`) renders the search form, server cards, and curve sparklines. No framework, no login. Apache reverse-proxies to PM2-managed Node on port **3003** (3001 = relay, 3002 reserved — confirm the free port on the Linode before deploy).

**Tech Stack:** Node.js 18+ (ESM), Express 4, better-sqlite3 9, undici (or native `fetch`) for outbound, vitest + supertest for tests. Vanilla JS + a hand-rolled SVG sparkline on the frontend. No build step.

---

## Riskiest Assumption (read before Task 1)

**The entire product rests on one bet: that BattleMetrics' free tier actually exposes enough population history to compute a meaningful day-1/2/3/5/7 curve per server.** If the free tier only gives current population (not historical time-series per wipe), the core differentiator is impossible and the whole plan changes shape.

**Task 1 tests this assumption before any product code is written.** It is a spike: hit the real API, find the historical-data endpoint, and confirm we can pull a population time-series for a known server across a wipe. If we can't, we re-plan (fall back to A2S polling + building our own history table over time, which is a different, slower product). Do not build the curve UI, the filters, or the cards until Task 1 proves the data exists.

---

## File Map

```
/var/www/serverrat.perezbox3.com/
├── server/
│   ├── index.js          — assembles db + app, starts server (entry point per package.json)
│   ├── app.js            — createApp({ db, bm }) → Express app (testable, no listen)
│   ├── db.js             — createDb(path) → cache helpers (servers, snapshots)
│   ├── battlemetrics.js  — createBmClient({ fetch, baseUrl }) → API client + cache wrapper
│   ├── curve.js          — computePopulationCurve(snapshots, wipeTime) → { day1, day2, ... }
│   ├── filter.js         — filterServers(servers, criteria) → matched + scored servers
│   └── routes/
│       ├── servers.js    — GET /api/servers (search/filter), GET /api/servers/:id
│       └── match.js      — POST /api/match (schedule → ranked servers)
├── public/
│   ├── index.html        — single page: filter sidebar + results grid
│   ├── style.css         — design system (dark, "street rat" aesthetic)
│   ├── app.js            — fetch + render: filters, cards, "match my schedule"
│   └── sparkline.js      — renderSparkline(curve) → inline SVG string
├── tests/
│   ├── db.test.js
│   ├── curve.test.js
│   ├── filter.test.js
│   ├── battlemetrics.test.js
│   └── routes/servers.test.js
├── docs/
│   └── battlemetrics-findings.md  — Task 1 spike output (the data contract)
├── deploy/
│   └── apache.conf       — reference Apache vhost
├── package.json          — (exists)
├── .env.example
├── .gitignore            — (exists)
└── ecosystem.config.cjs  — PM2 config
```

---

## Task 1: BattleMetrics Data Spike (prove the curve is possible)

> This is the walking-skeleton risk probe. Output is a findings doc + one throwaway script, NOT product code. No tests — it's exploration. Its definition of done is a decision, not a feature.

**Files:**
- Create: `scripts/spike-bm.js` (throwaway probe)
- Create: `docs/battlemetrics-findings.md` (the data contract)

- [ ] **Step 1 (FIRST STEP — do this literally first):** Create `scripts/spike-bm.js` that calls the BattleMetrics servers list endpoint for Rust and prints the raw JSON of the first result:

```javascript
// scripts/spike-bm.js — throwaway. Goal: learn the API shape, then delete.
const BASE = 'https://api.battlemetrics.com'

const res = await fetch(`${BASE}/servers?filter[game]=rust&page[size]=1`)
const json = await res.json()
console.log(JSON.stringify(json, null, 2))
```

```bash
cd /var/www/serverrat.perezbox3.com && node scripts/spike-bm.js
```

Expected: one Rust server object. Note the `id`, and which attributes carry current/max players and wipe info.

- [ ] **Step 2:** Using that server `id`, probe the historical/time-series endpoint. Try `/servers/{id}?include=...` and the player-count history endpoint (`/servers/{id}/relationships/...` or `/metrics`). The question to answer: **can we get player count over time for the last wipe cycle?**

- [ ] **Step 3:** Determine how wipe time is exposed — a `details.rust_last_wipe` attribute, a tag, or inferred from a population reset. Write down exactly where wipe time comes from.

- [ ] **Step 4:** Write `docs/battlemetrics-findings.md` answering, concretely:
  - Endpoint(s) and exact query params for: (a) listing Rust servers with filters, (b) fetching one server's population history.
  - The JSON path to: current players, max players, wipe schedule/last wipe, server type (vanilla/2x/5x), group-size tag, region/country.
  - Time granularity of history (per-minute? hourly? daily?) and how far back the free tier allows.
  - Rate limits observed (status 429? documented cap?).
  - **The verdict:** can we compute a day-1/2/3/5/7 curve from this data? YES → proceed to Task 2 as planned. NO → STOP, hand back to tech-lead for a re-plan around A2S + self-built history.

- [ ] **Step 5: Commit**

```bash
git add scripts/spike-bm.js docs/battlemetrics-findings.md
git commit -m "spike(bm): confirm BattleMetrics exposes population history for curves"
```

**Definition of done:** `docs/battlemetrics-findings.md` exists and states a clear YES/NO verdict on the curve, backed by real response shapes pasted from the live API. The exact JSON paths for every MVP field are documented (this is the data contract Tasks 2–6 depend on). The riskiest assumption is now answered.

**Gate:** None (spike, no production code). But the verdict must be reviewed by tech-lead before Task 2 — if NO, the plan below is wrong and gets re-cut.

**Estimate (you guess, we check at standup):** ___

---

## Task 2: Project Scaffold

**Files:**
- Modify: `package.json` (add deps + test script)
- Create: `.env.example`
- Create: `server/index.js` (stub)
- Create: `server/app.js` (stub)
- Create: `ecosystem.config.cjs`

- [ ] **Step 1 (FIRST STEP):** Update `package.json` to add the test script and dependencies:

```json
{
  "name": "serverrat",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch server/index.js",
    "start": "node server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "express": "^4.18.3"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^1.5.0"
  }
}
```

> Note: Node 18+ has global `fetch`, so no HTTP client dependency is needed. If you target older Node, add `undici` here and import it explicitly.

- [ ] **Step 2: Install**

```bash
cd /var/www/serverrat.perezbox3.com && npm install
```

Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 3: Create `.env.example`**

```
PORT=3003
DB_PATH=./serverrat.db

# BattleMetrics API (free tier). Token optional for public data; raises rate limits.
BATTLEMETRICS_TOKEN=
BM_BASE_URL=https://api.battlemetrics.com

# Cache TTL for server listings, in seconds
CACHE_TTL_SECONDS=300
```

- [ ] **Step 4: Create stub `server/app.js`**

```javascript
// server/app.js
import express from 'express'

export function createApp({ db, bm } = {}) {
  const app = express()
  app.use(express.json())
  app.use(express.static('public'))

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  return app
}
```

- [ ] **Step 5: Create stub `server/index.js`**

```javascript
// server/index.js
import { createApp } from './app.js'

const PORT = process.env.PORT || 3003

const app = createApp({})
app.listen(PORT, () => console.log(`ServerRat listening on ${PORT}`))
```

- [ ] **Step 6: Create `ecosystem.config.cjs`**

```javascript
module.exports = {
  apps: [{
    name: 'serverrat',
    script: './server/index.js',
    interpreter: 'node',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3003,
    },
  }],
}
```

- [ ] **Step 7: Verify the server boots and health responds**

```bash
cd /var/www/serverrat.perezbox3.com && cp .env.example .env && node server/index.js &
sleep 1 && curl -s http://localhost:3003/api/health && kill %1
```

Expected: `{"ok":true}`

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .env.example server/index.js server/app.js ecosystem.config.cjs
git commit -m "feat: project scaffold — Express + SQLite + vitest, /api/health stub"
```

**Definition of done:** `npm install` succeeds; `node server/index.js` boots on the configured port; `curl /api/health` returns `{"ok":true}`; PM2 config exists. Someone else could clone, `npm install`, `cp .env.example .env`, and run it.

**Gate:** `code-reviewer`.

**Estimate:** ___

---

## Task 3: SQLite Cache Layer

> Caches BattleMetrics responses so we don't re-hit the rate-limited free tier on every page load, and gives us a place to store population snapshots for curve computation. Two tables: `servers` (latest known state, JSON blob + parsed fields we filter on) and `snapshots` (player count at a timestamp, per server — the raw material for the curve).

**Files:**
- Create: `server/db.js`
- Create: `tests/db.test.js`

- [ ] **Step 1 (FIRST STEP): Write failing tests** in `tests/db.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../server/db.js'

let db
beforeEach(() => { db = createDb(':memory:') })

describe('upsertServer', () => {
  it('inserts a server and returns it', () => {
    const s = db.upsertServer({
      id: 'bm-1', name: 'Rusty Trio', region: 'US',
      type: '2x', wipe_day: 'Thursday', wipe_freq: 'biweekly',
      group_limit: 'trio', current_players: 120, max_players: 200,
      raw: JSON.stringify({ id: 'bm-1' })
    })
    expect(s.id).toBe('bm-1')
    expect(s.current_players).toBe(120)
  })

  it('updates an existing server on second upsert', () => {
    db.upsertServer({ id: 'bm-1', name: 'A', current_players: 10, raw: '{}' })
    db.upsertServer({ id: 'bm-1', name: 'A', current_players: 99, raw: '{}' })
    expect(db.getServer('bm-1').current_players).toBe(99)
  })
})

describe('listServers', () => {
  it('returns all cached servers', () => {
    db.upsertServer({ id: 'a', name: 'A', raw: '{}' })
    db.upsertServer({ id: 'b', name: 'B', raw: '{}' })
    expect(db.listServers()).toHaveLength(2)
  })
})

describe('snapshots', () => {
  it('records and reads player-count snapshots for a server', () => {
    db.upsertServer({ id: 'bm-1', name: 'A', raw: '{}' })
    db.addSnapshot({ server_id: 'bm-1', recorded_at: '2026-06-01T00:00:00Z', players: 250 })
    db.addSnapshot({ server_id: 'bm-1', recorded_at: '2026-06-03T00:00:00Z', players: 40 })
    const snaps = db.getSnapshots('bm-1')
    expect(snaps).toHaveLength(2)
    expect(snaps[0].players).toBe(250)
  })
})

describe('cache freshness', () => {
  it('isStale returns true when no fetch recorded', () => {
    expect(db.isStale('servers-list', 300)).toBe(true)
  })
  it('isStale returns false right after touchCache', () => {
    db.touchCache('servers-list')
    expect(db.isStale('servers-list', 300)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /var/www/serverrat.perezbox3.com && npm test -- tests/db.test.js
```

Expected: FAIL — `Cannot find module '../server/db.js'`

- [ ] **Step 3: Implement `server/db.js`.** Use `better-sqlite3`, WAL mode, foreign keys ON (match the Relay convention). Schema:

```sql
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  type TEXT,
  wipe_day TEXT,
  wipe_freq TEXT,
  group_limit TEXT,
  current_players INTEGER,
  max_players INTEGER,
  raw TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL REFERENCES servers(id),
  recorded_at TEXT NOT NULL,
  players INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_meta (
  key TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL
);
```

Helpers to export: `upsertServer`, `getServer`, `listServers`, `addSnapshot`, `getSnapshots(serverId)` (ordered by `recorded_at`), `touchCache(key)`, `isStale(key, ttlSeconds)`. **Parameterized queries only.** `upsertServer` uses `INSERT ... ON CONFLICT(id) DO UPDATE`.

- [ ] **Step 4: Run tests — expect all green**

```bash
npm test -- tests/db.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server/db.js tests/db.test.js
git commit -m "feat(db): SQLite cache for servers, snapshots, and cache freshness"
```

**Definition of done:** All `db.test.js` tests pass. WAL + foreign keys enabled. Every query parameterized. `isStale`/`touchCache` give the API layer a clean way to decide when to re-fetch.

**Gate:** `code-reviewer`.

**Estimate:** ___

---

## Task 4: BattleMetrics Client + Population Curve

> Two pieces that go together because the curve is meaningless without real data shaped by the client. The client is injectable (`{ fetch }`) so tests run offline against a fake. The curve function is pure — easiest thing in the codebase to test hard. **The exact endpoints, params, and JSON paths come from `docs/battlemetrics-findings.md` (Task 1). Do not guess them here; read that doc.**

**Files:**
- Create: `server/battlemetrics.js`
- Create: `server/curve.js`
- Create: `tests/battlemetrics.test.js`
- Create: `tests/curve.test.js`

- [ ] **Step 1 (FIRST STEP): Write failing tests for the pure curve function** in `tests/curve.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { computePopulationCurve } from '../server/curve.js'

const wipe = '2026-06-01T00:00:00Z'

function snap(dayOffset, players) {
  const t = new Date(Date.parse(wipe) + dayOffset * 86400000).toISOString()
  return { recorded_at: t, players }
}

describe('computePopulationCurve', () => {
  it('buckets snapshots into day1/2/3/5/7 averages relative to wipe', () => {
    const snaps = [snap(0.5, 300), snap(1.5, 200), snap(2.5, 90), snap(5.2, 30), snap(7.1, 10)]
    const curve = computePopulationCurve(snaps, wipe)
    expect(curve.day1).toBe(300)
    expect(curve.day2).toBe(200)
    expect(curve.day3).toBe(90)
    expect(curve.day5).toBe(30)
    expect(curve.day7).toBe(10)
  })

  it('averages multiple snapshots in the same day bucket', () => {
    const snaps = [snap(0.2, 100), snap(0.8, 200)]
    expect(computePopulationCurve(snaps, wipe).day1).toBe(150)
  })

  it('returns null for a day with no data', () => {
    const curve = computePopulationCurve([snap(0.5, 300)], wipe)
    expect(curve.day1).toBe(300)
    expect(curve.day7).toBeNull()
  })

  it('ignores snapshots before the wipe', () => {
    const snaps = [snap(-1, 999), snap(0.5, 300)]
    expect(computePopulationCurve(snaps, wipe).day1).toBe(300)
  })

  it('computes a retention ratio (day3 / day1)', () => {
    const curve = computePopulationCurve([snap(0.5, 300), snap(2.5, 90)], wipe)
    expect(curve.retention).toBeCloseTo(0.3)
  })
})
```

- [ ] **Step 2: Write failing tests for the client** in `tests/battlemetrics.test.js`. Inject a fake `fetch` so no network is touched; assert it maps the BattleMetrics JSON shape (from the findings doc) into our flat server objects, and that the cache short-circuits a second call:

```javascript
import { describe, it, expect, vi } from 'vitest'
import { createBmClient } from '../server/battlemetrics.js'

function fakeFetch(payload) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }))
}

describe('createBmClient.listRustServers', () => {
  it('maps BattleMetrics server JSON into flat objects', async () => {
    // Shape mirrors docs/battlemetrics-findings.md — adjust paths to match real API.
    const fetch = fakeFetch({ data: [{
      id: 'bm-9', attributes: {
        name: 'Trio Land', players: 120, maxPlayers: 200,
        country: 'US', details: { rust_type: '2x', rust_last_wipe: '2026-06-01T00:00:00Z' }
      }
    }]})
    const bm = createBmClient({ fetch, baseUrl: 'https://api.battlemetrics.com' })
    const servers = await bm.listRustServers()
    expect(servers[0]).toMatchObject({ id: 'bm-9', name: 'Trio Land', current_players: 120, max_players: 200, region: 'US', type: '2x' })
  })

  it('throws a clear error on non-ok response', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
    const bm = createBmClient({ fetch, baseUrl: 'x' })
    await expect(bm.listRustServers()).rejects.toThrow(/429/)
  })
})
```

- [ ] **Step 3: Run both — confirm red**

```bash
npm test -- tests/curve.test.js tests/battlemetrics.test.js
```

Expected: FAIL — missing modules.

- [ ] **Step 4: Implement `server/curve.js`** as a pure function: filter snapshots to `recorded_at >= wipeTime`, bucket by `floor(daysSinceWipe) + 1`, average players per target day (1,2,3,5,7), return `null` for empty buckets, and a `retention = day3 / day1` (null-safe). No I/O, no dependencies.

- [ ] **Step 5: Implement `server/battlemetrics.js`** — `createBmClient({ fetch = globalThis.fetch, baseUrl, token })` returning `{ listRustServers(filters), getServerHistory(id) }`. Build query strings from the findings doc, send the bearer token if present, throw `Error(\`BattleMetrics ${status}\`)` on `!res.ok`, and map raw JSON → flat objects matching the `servers` table columns. Explicit error handling, never swallow.

- [ ] **Step 6: Run tests — expect green**

```bash
npm test -- tests/curve.test.js tests/battlemetrics.test.js
```

- [ ] **Step 7: Live smoke test** (real network, manual — not a unit test): a one-off node `-e` call to `listRustServers()` printing the first mapped server, confirming the fake matched reality. If the live shape differs from the findings doc, fix the mapping and the doc.

- [ ] **Step 8: Commit**

```bash
git add server/curve.js server/battlemetrics.js tests/curve.test.js tests/battlemetrics.test.js
git commit -m "feat(bm): BattleMetrics client + pure population-curve computation"
```

**Definition of done:** Curve tests pass including the edge cases (pre-wipe snapshots ignored, empty buckets → null, multi-snapshot averaging, retention ratio). Client tests pass offline via injected fetch. A live smoke run returns a real mapped server. Curve is pure (no I/O). Client throws on non-ok responses.

**Gate:** `code-reviewer` AND `security-reviewer` (this task makes outbound requests and handles an API token — exactly the trigger).

**Estimate:** ___

---

## RE-PLAN HERE

> **Stop after Task 4 and return to tech-lead.** Tasks 1–4 are the engine: data proven, cached, shaped, and curve-computed. The remaining work (filter logic, API routes, frontend, deploy) should be re-cut against what Tasks 1–4 actually revealed about the data — especially whether history is rich enough for "match my schedule," or whether that feature parks for v2. The tasks below are the *intended* shape; treat them as provisional until the re-plan confirms them. Do not pre-build past here.

---

## Task 5 (provisional): Filter + Match Logic

**Files:** `server/filter.js`, `tests/filter.test.js`

- [ ] Write failing tests: `filterServers(servers, { wipe_day, wipe_freq, type, group_limit, region })` returns only matching servers; criteria are AND-combined; omitted criteria are wildcards. Add a `scoreMatch(server, { days, hours })` for "match my schedule" that ranks by historical population during the user's play window (uses snapshots/curve). Pure functions, no I/O.
- [ ] Run red → implement → run green.
- [ ] **DoD:** filtering is exact and AND-combined; empty criteria match all; match scoring is deterministic and unit-tested with a known fixture. **Gate:** `code-reviewer`. First step: write the filter test with three fixture servers and assert a two-criteria query returns exactly one.

**Estimate:** ___

---

## Task 6 (provisional): API Routes

**Files:** `server/routes/servers.js`, `server/routes/match.js`, wire into `server/app.js`, `tests/routes/servers.test.js`

- [ ] Write failing supertest tests against `createApp({ db, bm })` with a seeded in-memory db and fake bm: `GET /api/servers?wipe_day=Thursday&type=2x` returns filtered cards incl. curve; `GET /api/servers/:id` returns one server + full curve + snapshots; `POST /api/match` with `{ days, hours }` returns ranked servers. Routes read cache, refetch only when `isStale`.
- [ ] Run red → implement → run green.
- [ ] **DoD:** all route tests pass; routes never hit the live API in tests (injected `bm`); stale-cache logic verified by a test asserting `bm` is called once then served from cache. **Gate:** `code-reviewer` + `security-reviewer` (input handling on query/body params). First step: write the `GET /api/servers` happy-path test with a 2-server seeded db.

**Estimate:** ___

---

## Task 7 (provisional): Frontend

**Files:** `public/index.html`, `public/style.css`, `public/app.js`, `public/sparkline.js`

- [ ] Build the single page: filter sidebar (wipe day, freq, type, group limit, region), results grid of server cards (name, current/max pop, wipe schedule, **curve sparkline**, retention %, ping estimate, direct-connect button), and a "Match my schedule" panel. `sparkline.js` renders an inline SVG from a curve object — unit-testable as a pure string-returning function (`tests/sparkline.test.js`: returns `<svg>` with the right number of points, handles null days).
- [ ] **DoD:** page loads against the live local server and renders real cards with real sparklines; filters change results without a full reload; direct-connect button produces a working `steam://connect/IP:PORT` link; sparkline test passes. Manual smoke documented in README. **Gate:** `code-reviewer`. First step: static `index.html` with the filter form and an empty results grid, served by Express, loads in the browser.

**Estimate:** ___

---

## Task 8 (provisional): Apache + Deploy

**Files:** `deploy/apache.conf`, update README/CLAUDE.md deploy notes

- [ ] Create `deploy/apache.conf` (80→443 redirect + `ProxyPass / http://localhost:3003/` + security headers, mirroring Relay's; no WebSocket block — ServerRat has no sockets). Document the Linode deploy: `git pull`, `npm install --production`, `pm2 start ecosystem.config.cjs` / `pm2 restart serverrat`, `pm2 save`, then `sudo certbot --apache -d serverrat.perezbox3.com`.
- [ ] **DoD:** config file committed; deploy steps in README are accurate and runnable by Anthony in his open Linode session; **the port (3003) is confirmed free on the Linode** before going live (3001 is relay). **Gate:** `code-reviewer` + `security-reviewer` (reverse proxy + headers). First step: copy Relay's apache.conf, swap servername/port, delete the WebSocket rewrite block.
- [ ] **This task does NOT push or deploy.** It produces the config and the runbook. Anthony runs the deploy in his own SSH session and confirms the live site, per the global workflow. No outward action without his explicit go-ahead.

**Estimate:** ___

---

## Out of Scope (this plan deliberately excludes)
- User accounts / login / saved searches (MVP is no-login by design).
- Writing our own continuous population-history collector (a cron that polls A2S and builds long-term history). We rely on BattleMetrics' history for MVP; self-collection is a v2 bet, only forced if Task 1 says NO.
- Real-time A2S live-player queries (secondary source — defer until BattleMetrics gaps prove it's needed).
- Multi-game support. Rust only.
- Server owner / claim / promote features. This is a player-side finder.
- Mobile app / PWA / push notifications.
- Any paid tier, ads, or analytics.

## Parked (good ideas, not now — review at re-plan, not mid-task)
- A2S supplemental live counts for "is it populated *right now*" accuracy.
- "Notify me when this server wipes" (needs accounts → out of MVP).
- Region ping measured client-side instead of estimated.
- Historical curve overlay comparing 2–3 servers side by side.
- Favorites stored in localStorage (no-login-friendly, low cost — first parked item to reconsider).

## Re-Plan Triggers
- **After Task 1:** mandatory. The YES/NO verdict either confirms this plan or rewrites it.
- **After Task 4:** mandatory (marked above). Re-cut Tasks 5–8 against real data shape; decide if "match my schedule" is MVP or parked.
- Cap: no more than ~3 active tasks at once. Tasks 5–8 are provisional, not committed work.

---
---

# FINALIZED RE-PLAN — Tasks 5-8 (post-Task-4, 2026-06-19)

> **This section supersedes the four "(provisional)" tasks above.** Where they conflict, this wins. The provisional versions are kept above only as a record of the original sketch. Tasks 5-8 below are grounded in the **actual** code shipped in Tasks 1-4 (commits `ce8fef6` -> `d238b43`) and the real BattleMetrics data shape.

## What the re-plan learned (the deltas that reshaped this)

The engine (Tasks 1-4) is real and on disk. Reading it changed four things in the downstream plan:

1. **`server/db.js` already filters in SQL.** `listServers({ region, type, wipe_day, wipe_freq, group_limit })` builds an AND-combined `WHERE` and returns rows sorted by `current_players DESC`. The original Task 5 assumed `filter.js` would own all filtering — it does **not**. Most exact-match filtering is done. `filter.js` shrinks to the two things SQL doesn't do cleanly: **null-aware "any" handling** and **match-by-schedule ranking**.
2. **`server/curve.js` returns an OBJECT, the design wants an ARRAY.** Backend produces `{ day1, day2, day3, day5, day7, retention }` (rounded ints, `null` for empty buckets). The design ZIP's data shape is `curve: [n,n,n,n,n]` plus a derived `health` label and a human `note`. The **API layer owns this translation** (object -> ordered array + a `health` band derived from `retention`). Named explicitly in Task 6 so it doesn't get improvised in the frontend.
3. **`getServerHistory(id, { start, stop })` needs a time window** — it is not parameterless. Routes must compute `{ start, stop }` from the server's `last_wipe` (start = `last_wipe`, stop = now, clamped to ~8 days). That computation is a Task 6 concern with its own edge case (null `last_wipe`).
4. **The design ZIP is React + in-browser Babel** (`Perezbox3.com.zip` -> `serverrat-export/`: `sr-app.jsx`, `sr-results.jsx`, `sr-detail.jsx`, `sr-match.jsx`, `sr-landing.jsx`, `sr-privacy.jsx`, `sr-components.jsx`, `tweaks-panel.jsx`, `image-slot.js`, `sr-data.js` mock data, `serverrat.css`, `index.html`, and two PNGs `sr-mascot.png` / `sr-head.png`). It loads React/ReactDOM/Babel from unpkg and transpiles in the browser. **That violates the "vanilla JS, no build step, no framework" rule in CLAUDE.md.** Task 7 is therefore a **port**, not a drop-in: lift `serverrat.css` and the two PNGs **as-is**, port the JSX components to vanilla DOM JS, and replace `sr-data.js` mock data with `fetch()` calls to our real API. This is the biggest task — see Task 7's split.

**"Match my schedule" verdict: IN for MVP, but reduced.** Task 4 confirmed history is real but **sparse** (one server had 9 points over 8 days; curve days can be null). A scoring model that ranks by "population during your exact play hours" needs dense hourly history we don't reliably have. So match-my-schedule ships as a **filter + retention-rank**, not an hours-of-day heatmap: it filters to the user's `wipe_day`/`wipe_freq`/`type`/`group_limit`/`region` and ranks survivors by `retention` (day3/day1) then `current_players`. The hours-of-day heatmap is **PARKED** (added to the list below). This keeps the headline feature honest against the data we actually have.

## Order and why

`5 -> 6 -> 7 -> 8`, unchanged from the sketch, because the dependency chain is real:

- **Task 5 (filter + match logic)** is pure functions with no I/O — cheapest to test, and Task 6's routes import it. It goes first so the routes have something correct to call. It is also the **riskiest remaining assumption** (see below), so it leads for the same reason Task 1 led the whole project: test the bet cheaply before building on it.
- **Task 6 (routes)** wires db + bm + filter + curve into HTTP. It can't be meaningfully built until 5 exists and is trusted.
- **Task 7 (frontend)** consumes the routes. Building it before 6 means coding against an imagined API; building it after means real `fetch` calls against a running server.
- **Task 8 (deploy)** is last by definition — you deploy what's built. It needs the real `public/` and routes to proxy.

## Riskiest remaining assumption

**That the sparse, often-null curve data still produces a *useful* ranking** — i.e. that enough servers have a non-null `retention` for "rank by who holds population" to return a meaningful, non-empty list. If most servers come back with `retention: null` (because day1 or day3 bucket is empty), the headline sort collapses and the product shows an unranked blob.

**Task 5 tests this cheaply, before any route or UI:** its match/sort function must define and unit-test the **null-retention tie-break** (servers with `null` retention sort *below* any server with a real retention, ordered among themselves by `current_players`). The first standup after Task 5 should also eyeball a live `listRustServers` + a few `getServerHistory` calls to count how many of ~100 servers yield a non-null retention. If it's a tiny fraction, that's a PLAN-IS-WRONG signal — re-plan the ranking (e.g. fall back to current_players, surface retention only when present) before building Task 6 on top of it.

---

## TASK 5 — Filter refinement + match ranking (`server/filter.js`)

**Scope (what is IN):** The pure-function layer the routes call. Specifically:
- `filterServers(servers, criteria)` — takes already-fetched server objects (the route may pass DB rows or live-mapped objects) and applies criteria that **SQL can't express cleanly**: treat `group_limit: 'any'` and `null` schedule fields as wildcards that should still match a user who didn't filter on them, and let a server with `wipe_day: null` be **excluded** when the user *does* specify a wipe day (you can't promise a schedule you don't know). AND-combine. Omitted criteria match everything.
- `scoreMatch(server, curve)` -> a sortable numeric/typed key, **null-safe**: a server with a real `retention` always ranks above one with `retention: null`; ties and null-retention servers fall back to `current_players DESC`.
- `rankServers(serversWithCurves, criteria)` — filter then sort by the match key. Deterministic.

**Out (explicitly NOT in Task 5):** hours-of-day scoring, any DB or HTTP access, any fetching. Pure in, pure out.

**Files:**
- Create: `server/filter.js` (named exports: `filterServers`, `scoreMatch`, `rankServers` — named exports only, per CLAUDE.md)
- Create: `tests/filter.test.js`

**First step (literal):** In `tests/filter.test.js`, write the red test with **three fixture servers** — one Thursday/trio/2x with `retention 0.9`, one with `wipe_day: null`, one Friday/5x with `retention: null` — and assert that `rankServers(fixtures, { wipe_day: 'Thursday' })` returns **exactly the Thursday server** (the null-wipe-day one is excluded because a wipe day was requested), and that across a no-criteria call the real-retention server sorts above the null-retention one. Run it red (`npm test -- tests/filter.test.js` -> "Cannot find module").

**Definition of done (checkable by a third party):**
- `npm test -- tests/filter.test.js` is green, and the suite explicitly covers: (a) AND-combination of two criteria returning exactly one of three fixtures; (b) omitted criteria act as wildcards; (c) `group_limit: 'any'` server matches a user asking for `trio`; (d) a `wipe_day: null` server is **excluded** when the user specifies a wipe day, but **included** when they don't; (e) the **null-retention tie-break** — real retention ranks above null, null-retention servers ordered by `current_players`.
- Every export is pure: no `import` of `db`, `battlemetrics`, or `fetch` anywhere in `server/filter.js` (grep it to confirm).
- No `console.log`, no dead code.

**Gate:** `code-reviewer`. (No outbound / no input-boundary -> security-reviewer not required for this task.)

**Estimate (you guess, we check at standup):** ___

---

## TASK 6 — API routes (`server/routes/servers.js`, `server/routes/match.js`)

**Scope (what is IN):**
- `GET /api/servers` — read query params (`region, type, wipe_day, wipe_freq, group_limit`), serve from `db.listServers(...)`. If `db.isStale('servers-list', CACHE_TTL_SECONDS)` (or the table is empty), call `bm.listRustServers()`, `upsertServer` each, `touchCache('servers-list')`, then serve from DB. Returns server cards **without** per-server curves (curves are lazy — confirmed by Task 4: one HTTP call per server, can't preload 100).
- `GET /api/servers/:id` — return the one server **plus its curve**. Lazy-load history: if snapshots are stale/absent, compute `{ start, stop }` from the server's `last_wipe` (start = `last_wipe`; stop = now; if `last_wipe` is null, fall back to now-minus-8-days), call `bm.getServerHistory(id, { start, stop })`, `addSnapshot` each, `touchCache('history:'+id)`, then `computePopulationCurve(getSnapshots(id), last_wipe)`. **Translate the curve object -> the design's array shape** here: `[day1,day2,day3,day5,day7]` plus a `health` band derived from `retention` (e.g. `>=0.7` healthy, `>=0.4` fading, else dying — exact bands are a one-line decision the reviewer can check) and pass through `retention`.
- `POST /api/match` — body `{ wipe_day, wipe_freq, type, group_limit, region }`. Filter cached servers via `filterServers`, rank via `rankServers`. Because curves are expensive, match ranks on **stored retention where available** (compute/refresh curves only for the filtered subset, capped — e.g. top N by current_players — not all 100). Returns ranked cards.
- Wire both routers into `server/app.js` (it currently only has `/api/health`).

**Out:** any new caching primitive (use `isStale`/`touchCache` as-is), pagination, the hours-of-day match.

**Risks / edge cases the developer MUST handle:**
- **Curve object vs array mismatch** — the single most likely bug. The route is the only place the translation happens; assert it in a test.
- **Null `last_wipe`** -> history window fallback; a curve that comes back all-null must serialize as `null`s, not crash the card.
- **Input validation at the boundary** (CLAUDE.md security rule): whitelist query/body param values against the known enums (`type`, `wipe_day`, `wipe_freq`, `group_limit`, `region` code shape). Reject/ignore unknown keys; never pass raw user strings into the BM client URL.
- **Cache short-circuit**: a test must prove `bm.listRustServers` is called **once** then served from DB on the second request (assert call count on the injected fake).
- **BM error propagation**: a non-ok BM response throws (Task 4 behavior) — the route must catch and return a clean 502/503, never a stack trace to the client.

**Files:**
- Create: `server/routes/servers.js`, `server/routes/match.js`
- Edit: `server/app.js` (mount the routers)
- Create: `tests/routes/servers.test.js` (supertest against `createApp({ db, bm })` with `:memory:` db + fake bm)

**First step (literal):** Write the `GET /api/servers` happy-path supertest: seed a `:memory:` db (via the real `createDb`) with two servers, pass a fake `bm`, `createApp({ db, bm })`, and assert `GET /api/servers?type=2x` returns 200 with exactly the matching card and that the fake `bm.listRustServers` was **not** called when the cache is fresh. Run it red.

**Definition of done:**
- `npm test -- tests/routes/servers.test.js` green; tests **never** hit the live API (injected `bm`), per CLAUDE.md.
- Covered: happy-path filtered list; `:id` returns server + curve **as an array** + `health` + `retention`; `POST /api/match` returns servers in ranked order (real-retention first, null-retention last); stale-cache test proves one fetch then cache; input-validation test proves a junk `type` value doesn't reach the BM client; a BM-error test proves the route returns a clean 5xx, not a crash.
- `server/app.js` mounts both routers; `/api/health` still works.

**Gate:** `code-reviewer` **AND** `security-reviewer` (input handling on query + body params, and outbound BM requests — both triggers per CLAUDE.md).

**Estimate:** ___

---

## TASK 7 — Frontend: port the design to vanilla JS (`public/`)

> **This is a port, not a drop-in.** The ZIP (`Perezbox3.com.zip` -> `serverrat-export/`) is React + in-browser Babel, which violates the "vanilla JS, no framework, no build step" rule. Lift the **CSS and image assets as-is**; rewrite the **JSX components as vanilla DOM**; replace **`sr-data.js` mock data** with `fetch()` against the Task 6 routes. It is the largest task — if it can't be done in one sitting, split at the marked seam and re-plan (do not let it sprawl).

**Scope (what is IN):**
- Extract from the ZIP into `public/`: `serverrat.css` (as-is), `assets/sr-mascot.png` + `assets/sr-head.png` (as-is, used as favicon + landing mascot).
- `public/index.html` — own hand-written head (fonts the design uses: Archivo / Press Start 2P / VT323), links `serverrat.css`, a `#root`, and `<script type="module" src="app.js">`. **No React, no Babel, no unpkg.**
- `public/app.js` — vanilla render + fetch. Views to port from the JSX: **results grid** (server cards: name, current/max pop, wipe schedule, group/type/region, **sparkline**, retention %, direct-connect button), **server detail** (full curve + `health` + `note`), **match panel** (the reduced filter+rank), and the **landing/hero** with the mascot. Filters are URL params (no login, stateless — per CLAUDE.md). Privacy view can be a static page port.
- `public/sparkline.js` — `renderSparkline(curveArray)` -> inline `<svg>` string. **Pure, unit-testable.** Handles `null` days (gap in the line, not a crash).

**Out:** any framework, any bundler, the in-browser Babel pipeline, the ZIP's `image-slot.js`/`tweaks-panel.jsx` tooling (those are design-export scaffolding, not product).

**Risks / edge cases:**
- **Curve array may contain `null`s** (sparse data) — the sparkline must render a clean gap, and cards must show "-" not "NaN" for null days / null retention.
- **`health`/`note` come from the API now**, not mock data — the card must degrade gracefully if `health` is "unknown" (null retention).
- **Direct-connect link**: the design implies a `steam://connect/IP:PORT` button — confirm IP:PORT is actually in the BM `raw`/mapped data; if not, this button is PARKED, not faked.
- **Asset paths** — the ZIP references `assets/...` relative; keep that structure under `public/`.

**Files:**
- Create: `public/index.html`, `public/serverrat.css` (match the ZIP name), `public/app.js`, `public/sparkline.js`, `public/assets/sr-mascot.png`, `public/assets/sr-head.png`
- Create: `tests/sparkline.test.js`

**Split seam (if one sitting isn't enough):** Stop after **static page + results grid + sparkline render against live local routes** (a real, demoable slice), commit, and re-plan the detail/match/landing polish as Task 7b. A working results grid is observable value; the rest is enrichment.

**First step (literal):** Unzip `Perezbox3.com.zip` to a scratch dir, copy `serverrat.css` and the two PNGs into `public/` (+`public/assets/`), and write a minimal `public/index.html` with the fonts, the stylesheet link, a `#root`, and an empty results `<section>` — confirm Express `static` serves it and it loads in the browser with the design's look (dark, mascot). No data yet.

**Definition of done:**
- `npm test -- tests/sparkline.test.js` green: `renderSparkline` returns an `<svg>` with the expected point count and renders a **gap** for a null day without throwing.
- Page loads against the **running local server** (`node server/index.js`) and renders **real cards from `/api/servers`** with **real sparklines** from `/api/servers/:id`; filters change results via URL params without a full reload; null curve days / null retention show "-", never NaN/crash.
- Zero React/Babel/unpkg references in shipped `public/`. No build step (loads directly).
- Manual smoke documented in README: how to start the server and what to click.

**Gate:** `code-reviewer`.

**Estimate:** ___

---

## TASK 8 — nginx vhost + deploy runbook (`deploy/nginx.conf`)

> **Correction from the provisional sketch:** the provisional Task 8 said **Apache**. CLAUDE.md and the environment are **nginx** (`sudo certbot --nginx`, "nginx reverse-proxies to Node on 3003", `deploy/nginx.conf`). This task is **nginx**. The Apache wording above is dead — ignore it.

**Scope (what is IN):** Produce `deploy/nginx.conf` (full vhost, below) and an accurate README deploy runbook. **This task does NOT push, deploy, or restart anything** — Anthony runs it in his own persistent SSH session with explicit go-ahead (CLAUDE.md + global workflow).

**Risks / edge cases:**
- **Confirm port 3003 is free** on the personal server before going live (3001 = relay; gamepickle shares the box). The runbook must include the check.
- Certbot will rewrite the vhost to add the 443 server block + redirect — the committed file is the **pre-certbot** HTTP vhost plus the proxy; note that in a comment so the post-certbot diff isn't a surprise.
- Security headers are required (CLAUDE.md): `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- No WebSocket block — ServerRat has no sockets.

**Files:**
- Create: `deploy/nginx.conf` (full content below)
- Edit: `README` (or `CLAUDE.md` deploy notes) — runbook

**Full `deploy/nginx.conf` content:**

```nginx
# deploy/nginx.conf — ServerRat reverse proxy.
# Pre-certbot HTTP vhost. Run `sudo certbot --nginx -d serverrat.perezbox3.com`
# after this is in place; certbot adds the 443 server block + HTTP->HTTPS redirect.
# Node app runs under PM2 on 127.0.0.1:3003 (confirm 3003 is free before deploy — 3001 is relay).

server {
    listen 80;
    listen [::]:80;
    server_name serverrat.perezbox3.com;

    # Security headers (required by CLAUDE.md).
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    access_log /var/log/nginx/serverrat.access.log;
    error_log  /var/log/nginx/serverrat.error.log;

    # Cache static assets (CSS, JS, the mascot PNGs) hard; the app is stateless.
    location ~* \.(?:css|js|png|svg|ico|woff2?)$ {
        proxy_pass http://127.0.0.1:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 7d;
        add_header Cache-Control "public";
    }

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }
}
```

**Deploy runbook (goes in README — Anthony runs it in his open SSH session, no new connections):**

```bash
# 0. Confirm 3003 is free on the personal server (3001 = relay).
sudo ss -ltnp | grep ':3003' || echo "3003 is free"

# 1. Place the vhost and enable it.
sudo cp /var/www/serverrat.perezbox3.com/deploy/nginx.conf /etc/nginx/sites-available/serverrat.perezbox3.com
sudo ln -sf /etc/nginx/sites-available/serverrat.perezbox3.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 2. Deploy the app.
cd /var/www/serverrat.perezbox3.com
git pull
npm install --production
cp -n .env.example .env   # then edit .env (PORT=3003, CACHE_TTL_SECONDS, optional BM token)
pm2 start ecosystem.config.cjs && pm2 save   # first time; later: pm2 restart serverrat

# 3. SSL (one-time). Certbot rewrites the vhost to add 443 + redirect.
sudo certbot --nginx -d serverrat.perezbox3.com

# 4. Verify.
curl -s https://serverrat.perezbox3.com/api/health   # expect {"ok":true}
```

**First step (literal):** Create `deploy/nginx.conf` with the content above; structural-parity check it by eye against the existing relay/gamepickle vhost on the box (servername + port swapped, no WebSocket block). Local `nginx -t` is N/A on the Windows dev machine — validation happens on the server in step 1 of the runbook.

**Definition of done:**
- `deploy/nginx.conf` committed with the full vhost above; security headers present; proxies to `127.0.0.1:3003`; no WebSocket block.
- README runbook is accurate and runnable by Anthony in his existing SSH session; it includes the **3003-free check** and the certbot step.
- **Port 3003 confirmed free** on the personal server before go-live (stated as a gate, executed by Anthony — not by this agent).
- This task produced **only** config + docs. No deploy, no PM2 restart, no push was performed by the agent.

**Gate:** `code-reviewer` **AND** `security-reviewer` (reverse proxy + headers).

**Estimate:** ___

---

## Out of scope (Tasks 5-8) — unchanged from the master list, plus:
- Hours-of-day "play window" match scoring (needs dense hourly history we don't reliably have — see PARKED).
- Server-owner / direct-connect IP features beyond what BM already returns in `raw`.
- Any build step, bundler, or framework on the frontend (the design ZIP's React pipeline is deliberately dropped).

## PARKED (review at next re-plan, not mid-task)
- **Hours-of-day match heatmap** — rank by average population during the user's exact play hours. Parked because Task 4 confirmed history is too sparse (9 points / 8 days on the sampled server) to support it honestly. Reconsider if we ever build our own continuous history collector.
- **`steam://connect/IP:PORT` direct-connect button** — only if IP:PORT is reliably present in the mapped BM data; verify in Task 7, park if not.
- **Favorites in localStorage** (no-login-friendly, low cost — first to reconsider).
- **Side-by-side curve overlay** comparing 2-3 servers.

## Re-plan triggers (forward)
- **After Task 5:** quick standup checkpoint — count how many of ~100 live servers yield a non-null `retention`. If it's a tiny fraction, the ranking assumption failed -> re-plan the sort before Task 6.
- **After Task 7 (or at the split seam):** if Task 7 split into 7a/7b, re-plan 7b scope from what the results-grid slice actually proved.
- **Cap:** Task 5 is the only fully-active task now; 6-8 are scoped but not in flight. One task at a time.
