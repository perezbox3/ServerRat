// Spike: BM history backfill rate-limit probe.
// Crawls BM catalog, takes the first TARGET_SERVERS BM-indexed servers with
// a last_wipe, calls getServerHistory for each at SLEEP_MS intervals, and
// prints a verdict that decides Task 2's scope.
//
// Run: node scripts/spike-backfill.js
// Appends verdict to docs/battlemetrics-findings.md on completion.

import 'dotenv/config'
import { createBmClient } from '../server/battlemetrics.js'
import { computePopulationCurve } from '../server/curve.js'
import { writeFileSync, appendFileSync } from 'node:fs'

const TARGET_SERVERS = 100   // how many BM servers to probe
const SLEEP_MS       = 1000  // 1 req/sec — confirmed safe in original spike
const MAX_PAGES      = 10    // safety cap on catalog pages (10 × 100 = 1000 servers scanned)

const sleep = ms => new Promise(r => setTimeout(r, ms))

const bm = createBmClient({
  baseUrl: process.env.BM_BASE_URL ?? 'https://api.battlemetrics.com',
  token:   process.env.BATTLEMETRICS_TOKEN ?? null,
})

// ── Phase 1: collect TARGET_SERVERS BM-indexed servers with last_wipe ─────────

console.log(`[spike] scanning BM catalog for ${TARGET_SERVERS} servers with last_wipe…`)
const targets = []
let cursor = null

for (let page = 0; page < MAX_PAGES && targets.length < TARGET_SERVERS; page++) {
  let batch, next
  try {
    ;({ servers: batch, nextUrl: next } = await bm.fetchPageCursor(cursor))
  } catch (e) {
    console.error(`[spike] catalog page ${page} failed: ${e.message}`)
    break
  }
  for (const s of batch) {
    if (!s.id.startsWith('steam_') && s.last_wipe) targets.push(s)
    if (targets.length >= TARGET_SERVERS) break
  }
  console.log(`  page ${page + 1}: ${batch.length} servers, ${targets.length} targets so far`)
  cursor = next
  if (!next || batch.length < 100) break
  if (page < MAX_PAGES - 1) await sleep(SLEEP_MS)
}

if (!targets.length) {
  console.error('[spike] no eligible servers found — check BM connectivity')
  process.exit(1)
}

const probe = targets.slice(0, TARGET_SERVERS)
console.log(`\n[spike] probing ${probe.length} servers at ${SLEEP_MS}ms intervals…\n`)

// ── Phase 2: call getServerHistory for each ───────────────────────────────────

const results = []
const wallStart = Date.now()

for (let i = 0; i < probe.length; i++) {
  const s = probe[i]
  const reqStart = Date.now()
  let status = 'ok', points = 0, retention = null, httpStatus = null

  try {
    const stop  = new Date().toISOString()
    const start = s.last_wipe  // history from wipe → now gives us the post-wipe curve
    const history = await bm.getServerHistory(s.id, { start, stop })
    points = history.length

    if (points > 0 && s.last_wipe) {
      const snapshots = history.map(h => ({ recorded_at: h.recorded_at, players: h.players }))
      const curve = computePopulationCurve(snapshots, s.last_wipe)
      retention = curve.retention
    }
    httpStatus = 200
  } catch (e) {
    status = 'fail'
    const m = e.message.match(/BattleMetrics (\d+)/)
    httpStatus = m ? parseInt(m[1], 10) : null
  }

  const elapsed = Date.now() - reqStart
  results.push({ id: s.id, name: s.name, status, httpStatus, points, retention, elapsed })

  const retStr = retention != null ? `ret=${(retention * 100).toFixed(0)}%` : 'ret=—'
  const icon   = status === 'ok' ? '✓' : '✗'
  process.stdout.write(`  ${icon} [${i + 1}/${probe.length}] ${s.name.slice(0, 50).padEnd(50)} ${String(points).padStart(4)} pts ${retStr} (${elapsed}ms)\n`)

  if (i < probe.length - 1) await sleep(SLEEP_MS)
}

const wallMs = Date.now() - wallStart

// ── Phase 3: compute and print summary ────────────────────────────────────────

const ok      = results.filter(r => r.status === 'ok')
const failed  = results.filter(r => r.status === 'fail')
const by429   = failed.filter(r => r.httpStatus === 429)
const by400   = failed.filter(r => r.httpStatus === 400)
const withCurve = ok.filter(r => r.retention !== null)
const withPts   = ok.filter(r => r.points > 0)
const medianPts = withPts.length
  ? [...withPts].sort((a, b) => a.points - b.points)[Math.floor(withPts.length / 2)].points
  : 0

const successRate    = ((ok.length / results.length) * 100).toFixed(1)
const curveRate      = ok.length ? ((withCurve.length / ok.length) * 100).toFixed(1) : '0'
const wallSec        = (wallMs / 1000).toFixed(1)
const fullCatalogEst = probe.length ? Math.round((wallMs / probe.length) * 3000 / 60000) : '?'
// assume ~3,000 BM-indexed servers in the real catalog

console.log(`
╔═══════════════════════════════════════════════════════════╗
║              BM BACKFILL SPIKE — RESULTS                  ║
╠═══════════════════════════════════════════════════════════╣
║  Servers probed        : ${String(results.length).padStart(5)}                            ║
║  Success (HTTP 200)    : ${String(ok.length).padStart(5)}  (${successRate}%)                    ║
║  Failed                : ${String(failed.length).padStart(5)}  (429: ${by429.length}, 400: ${by400.length}, other: ${failed.length - by429.length - by400.length})          ║
║  With ≥1 datapoint     : ${String(withPts.length).padStart(5)}                            ║
║  Yield usable curve    : ${String(withCurve.length).padStart(5)}  (${curveRate}% of successes)        ║
║  Median datapoints/srv : ${String(medianPts).padStart(5)}                            ║
║  Wall time (${String(results.length).padStart(3)} servers): ${wallSec.padStart(6)}s                         ║
║  Est. full catalog(3k) : ~${String(fullCatalogEst).padStart(4)} min                          ║
╚═══════════════════════════════════════════════════════════╝`)

// ── Verdict logic ─────────────────────────────────────────────────────────────

const sr = parseFloat(successRate)
let verdict, scope, populationFloor

if (sr >= 90 && by429.length === 0 && fullCatalogEst <= 90) {
  verdict = 'BACKFILL ALL'
  scope = 'Backfill all BM-indexed servers with last_wipe in one sweep. No floor needed.'
  populationFloor = null
} else if (sr >= 75 && fullCatalogEst <= 180) {
  verdict = 'BACKFILL WITH FLOOR'
  scope = 'Backfill BM servers above a population floor (e.g. current_players >= 10) to stay within rate budget.'
  populationFloor = 10
} else {
  verdict = 'BACKFILL TOP-N'
  scope = 'Rate limits or time budget too tight for full catalog. Backfill top 500 servers by current_players only.'
  populationFloor = 50
}

console.log(`
VERDICT: ${verdict}
${scope}
429s hit: ${by429.length} / ${results.length}  |  Success rate: ${successRate}%  |  Est. full sweep: ~${fullCatalogEst} min
`)

// ── Append verdict to findings doc ───────────────────────────────────────────

const ts = new Date().toISOString().slice(0, 10)
const appendix = `

---

## Backfill Spike — ${ts}

**Verdict: ${verdict}**

| Metric | Value |
|---|---|
| Servers probed | ${results.length} |
| Success rate | ${successRate}% |
| 429s hit | ${by429.length} |
| 400s hit | ${by400.length} |
| Servers yielding a curve | ${withCurve.length} / ${ok.length} (${curveRate}%) |
| Median datapoints / server | ${medianPts} |
| Wall time for ${results.length} servers | ${wallSec}s |
| Estimated full-catalog sweep (~3k servers) | ~${fullCatalogEst} min |

**Scope for Task 2:** ${scope}${populationFloor != null ? ` Population floor: \`current_players >= ${populationFloor}\`.` : ''}
`
appendFileSync('docs/battlemetrics-findings.md', appendix)
console.log('[spike] verdict appended to docs/battlemetrics-findings.md')
console.log('[spike] done.')
