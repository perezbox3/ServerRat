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
