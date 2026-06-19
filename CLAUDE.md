# CLAUDE.md — ServerRat

> Read this file at the start of every session. It is the source of truth for all decisions.

---

## What ServerRat Is

ServerRat is a Rust (the survival game) server finder. It surfaces the one thing BattleMetrics and just-wiped.net bury: how a server **holds** population across a wipe cycle. A player filters by wipe schedule, server type, group-size limit, and region, then sees a population curve (avg players on day 1/2/3/5/7 post-wipe) so they never join a server that looks alive on wipe day and dies by day 3.

**One sentence that must survive every decision:**
> "Does this help a Rust player avoid joining a server that's dead by day 3 — or is it just another data dashboard for nerds?"

If it's a dashboard for nerds, skip it. If it helps a player find a server that *holds*, build it. The population curve is the product; everything else is around it.

---

## Who It's For

Rust players who have a preferred wipe schedule (e.g. "Thursday biweekly"), play during specific hours, want a specific server type (vanilla/2x/5x) and group-size limit (solo/duo/trio), and are sick of dead servers four days into a wipe. No login. This is a player-side finder, not a server-owner tool.

---

## Environment

Two machines. Do not confuse them.

| Machine | Identity | Purpose |
|---|---|---|
| Local dev | `Anthony@Windows` (this machine) | Where code is written and tested. Claude Code runs here. |
| Production server | `ssh personal` | Serves `serverrat.perezbox3.com`. Same server as gamepickle.perezbox3.com. nginx + SSL + Node via PM2. |

**Claude Code only has direct access to the local dev machine.** Production changes (deploy, PM2 restart) are run by Anthony in his open SSH session — one persistent connection, never a new one per command.

Same server as gamepickle.perezbox3.com. **ServerRat runs on port 3003** — confirm it is free on the personal server before deploying.

---

## Deployment

```bash
# On the personal server, in the existing SSH session
cd /var/www/serverrat.perezbox3.com
git pull
npm install --production
pm2 restart serverrat   # or: pm2 start ecosystem.config.cjs && pm2 save
```

SSL (one-time): `sudo certbot --nginx -d serverrat.perezbox3.com`

Deployed to `/var/www/serverrat.perezbox3.com`. nginx reverse-proxies to Node on 3003. See `deploy/nginx.conf` for the vhost config.

---

## Stack

- **Runtime:** Node.js 18+ ESM (`"type": "module"`). Global `fetch` — no HTTP client dependency.
- **Server:** Express 4, better-sqlite3 9.
- **Outbound:** BattleMetrics API (primary, free tier). A2S protocol is a parked secondary source.
- **DB:** SQLite via better-sqlite3 (WAL mode, foreign keys ON). Caches server listings + population snapshots.
- **Testing:** Vitest + Supertest. `npm test`.
- **Process:** PM2 (`ecosystem.config.cjs`), proxied by Apache on port 3003.
- **Frontend:** Vanilla JS, no framework, no build step. Hand-rolled SVG sparkline for the curve.

---

## File Map

```
/var/www/serverrat.perezbox3.com/
├── server/
│   ├── index.js          — assembles db + app, starts server (entry point)
│   ├── app.js            — createApp({ db, bm }) → Express app (no listen; testable)
│   ├── db.js             — createDb(path) → cache helpers (servers, snapshots, freshness)
│   ├── battlemetrics.js  — createBmClient({ fetch, baseUrl, token }) → API client
│   ├── curve.js          — computePopulationCurve(snapshots, wipeTime) → day1/2/3/5/7 + retention
│   ├── filter.js         — filterServers(servers, criteria), scoreMatch(server, schedule)
│   └── routes/
│       ├── servers.js    — GET /api/servers (filter), GET /api/servers/:id
│       └── match.js      — POST /api/match (schedule → ranked)
├── public/
│   ├── index.html        — filter sidebar + results grid
│   ├── style.css         — design system (dark, street-rat aesthetic)
│   ├── app.js            — fetch + render
│   └── sparkline.js      — renderSparkline(curve) → inline SVG string
├── tests/
│   ├── db.test.js
│   ├── curve.test.js
│   ├── filter.test.js
│   ├── battlemetrics.test.js
│   └── routes/servers.test.js
├── docs/
│   └── battlemetrics-findings.md  — the API data contract (from Task 1 spike)
├── deploy/nginx.conf
├── ecosystem.config.cjs
├── .env.example
└── serverrat.md          — implementation plan (task checklist)
```

---

## Build Order

1. **Task 1 — BM data spike (RISK PROBE)** — prove the free tier exposes population history. Verdict gates everything.
2. **Task 2 — Scaffold** — Express + SQLite + vitest, `/api/health`.
3. **Task 3 — DB cache** — servers + snapshots + freshness.
4. **Task 4 — BM client + curve** — outbound + pure curve math. *(RE-PLAN after this.)*
5. **Task 5 — Filter + match logic** *(provisional)*
6. **Task 6 — API routes** *(provisional)*
7. **Task 7 — Frontend + sparkline** *(provisional)*
8. **Task 8 — Apache + deploy runbook** *(provisional)*

One task in flight at a time. Do not pre-build past the re-plan point.

---

## Code Rules

### Always
- Write failing tests first for unit-testable code (db, curve, filter, client mapping, routes). Run red, implement, run green.
- Run `npm test` before every commit. All tests pass.
- Small, focused commits. `type(scope): description` (e.g. `feat(bm): map server JSON`, `fix(curve): ignore pre-wipe snapshots`).
- Explain the approach and the tradeoff before writing code (Anthony is leveling up — the reasoning is the point).

### Code Style
- ESM only (import/export). No CommonJS `require` except the PM2 `.cjs` config.
- Named exports only. No default exports.
- Async/await with try/catch. No `.catch()` chains. Never swallow errors.
- Simplest code that works. No premature abstraction. No dead code, no leftover `console.log`.
- Comments only when the *why* is non-obvious.

### Database
- Parameterized queries always. No string interpolation in SQL.
- WAL mode + foreign keys ON, set in `createDb()` — don't override.
- `:memory:` for all DB tests. Test against the real `createDb` helper, never a mock.

### External API (BattleMetrics)
- The client takes an injectable `fetch` so tests run offline against a fake. Never hit the live API in unit tests.
- Endpoints, query params, and JSON paths come from `docs/battlemetrics-findings.md`. Don't guess them in code — read the contract.
- Throw a clear error on non-ok responses (include the status). Respect the free-tier rate limit; serve from the SQLite cache when not stale (`CACHE_TTL_SECONDS`).
- Never log the `BATTLEMETRICS_TOKEN`. Read it from env only.

### Security
- Validate/sanitize all input crossing a boundary: query params, request bodies, and every field parsed out of a BattleMetrics response.
- Secrets in `.env` only, never in code or logs. `.env` is gitignored.
- Apache sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

---

## The Agent Team (don't skip the gates)

| Step | Agent | When |
|---|---|---|
| PLAN | `tech-lead` | Any non-one-liner goal; also the mandatory re-plans after Task 1 and Task 4 |
| BUILD | *(Anthony writes every line)* | One task at a time |
| DISCUSS | `senior-dev-mentor` | Design fork mid-build |
| GATE | `code-reviewer` | After every task — not optional |
| GATE | `security-reviewer` | Tasks touching outbound requests, the API token, or input handling (Tasks 4, 6, 8) |
| STUCK | `diagnostic-engineer` | Blocked 30+ min with no new observation |
| DONE | `tech-lead` (done-check) | After gates pass — grade against the DoD |

---

## Do Not Do
- Don't build the curve UI, filters, or cards before Task 1 proves the population-history data exists.
- Don't hit the live BattleMetrics API in unit tests — inject a fake `fetch`.
- Don't add login, accounts, A2S live queries, or a self-built history collector to MVP (see Out of Scope in serverrat.md).
- Don't deploy or restart PM2 from here — that's Anthony's Linode session, with his explicit go-ahead.
- Don't use port 3001 (relay) — ServerRat is 3003.
- Don't refactor files outside the current task. Don't leave `console.log` or commented-out blocks.
- Don't quietly bend a task's DoD to match what got built. Re-plan openly instead.

---

## Verification

After every implementation, tell Anthony:
1. Which tests to run and the expected output.
2. How to verify end-to-end manually (curl the route, load the page, click direct-connect).
3. Whether any existing test needs updating and why.

---

*Keep this file current. Update it when the data contract, architecture, or constraints change — especially after the Task 1 and Task 4 re-plans.*
