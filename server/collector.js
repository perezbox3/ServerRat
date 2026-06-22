// Background collector — runs outside the request path.
// Phase 1: crawl ALL BM pages slowly (1s sleep) → full server catalog.
// Phase 2: merge Steam catalog → enriches IP/port, adds Steam-only servers.
// Phase 3: backfill BM history → writes snapshots + retention for top servers
//          so the curve exists without waiting for a user to visit the page.

import { computePopulationCurve } from './curve.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const MAX_BM_PAGES    = 200   // 200 × 100 = 20k servers max, well above real catalog size
const BACKFILL_CAP    = 500   // max servers to backfill per run (~8 min at 1 req/sec)
const BACKFILL_FLOOR  = 5     // skip servers with fewer current players (dead servers)
const BACKFILL_TTL    = 21600 // re-fetch history at most once every 6 hours

export async function runCollection({ db, bm, steam = null, sleepMs = 1000 } = {}) {
  const started = Date.now()
  let bmPages = 0, bmUpserted = 0, steamProcessed = 0, steamEnriched = 0,
      backfilled = 0, backfillFailed = 0, backfillSkipped = 0

  // ── Phase 1: BM full crawl (cursor pagination) ────────────────────────────
  console.log('[collector] BM crawl starting...')
  let nextUrl = null
  for (let page = 0; page < MAX_BM_PAGES; page++) {
    try {
      const { servers: batch, nextUrl: next } = await bm.fetchPageCursor(nextUrl)
      if (!batch.length) break
      for (const s of batch) {
        try { db.upsertServer(s) } catch (e) { console.warn(`[collector] skip ${s.id}: ${e.message}`) }
      }
      bmUpserted += batch.length
      bmPages++
      process.stdout.write(`\r[collector] BM page ${page + 1}: ${bmUpserted} servers`)
      nextUrl = next
      if (!nextUrl || batch.length < 100) break
      if (page < MAX_BM_PAGES - 1) await sleep(sleepMs)
    } catch (e) {
      console.error(`\n[collector] BM page ${page} failed: ${e.message}`)
      break
    }
  }
  db.touchCache('servers-list')
  console.log(`\n[collector] BM done — ${bmPages} pages, ${bmUpserted} servers (${Date.now() - started}ms)`)

  // ── Phase 2: Steam catalog merge ───────────────────────────────────────────
  if (steam) {
    console.log('[collector] Steam merge starting...')
    try {
      const steamServers = await steam.listRustServers()
      steamProcessed = steamServers.length
      for (const s of steamServers) {
        db.upsertSteamServer(s)
        steamEnriched++
      }
      console.log(`[collector] Steam done — ${steamProcessed} servers processed, ${steamEnriched} upserted`)
    } catch (e) {
      console.error('[collector] Steam merge failed:', e.message)
    }
  }

  // ── Phase 3: BM history backfill ──────────────────────────────────────────
  // Fetch population history for the most-active BM-indexed servers so the
  // curve is populated before anyone clicks the detail page.
  const candidates = db.listServersForBackfill({ floor: BACKFILL_FLOOR, cap: BACKFILL_CAP })
  console.log(`[collector] history backfill: ${candidates.length} candidates`)

  for (let i = 0; i < candidates.length; i++) {
    const { id, last_wipe } = candidates[i]
    const cacheKey = 'history:' + id

    if (!db.isStale(cacheKey, BACKFILL_TTL)) {
      backfillSkipped++
      continue
    }

    try {
      const stop    = new Date().toISOString()
      const history = await bm.getServerHistory(id, { start: last_wipe, stop })
      for (const pt of history) db.addSnapshot({ server_id: id, ...pt })

      if (history.length > 0) {
        const snapshots = db.getSnapshots(id)
        const curve = computePopulationCurve(snapshots, last_wipe)
        if (curve.retention !== null) db.updateRetention(id, curve.retention)
      }

      db.touchCache(cacheKey)
      backfilled++
      if (i % 50 === 0) process.stdout.write(`\r[collector] backfill ${i + 1}/${candidates.length}`)
    } catch (e) {
      console.warn(`\n[collector] history failed for ${id}: ${e.message}`)
      backfillFailed++
    }

    if (i < candidates.length - 1) await sleep(sleepMs)
  }

  console.log(`\n[collector] backfill done — ${backfilled} enriched, ${backfillFailed} failed, ${backfillSkipped} cached`)

  const elapsed = Date.now() - started
  console.log(`[collector] complete in ${(elapsed / 1000).toFixed(1)}s`)
  return { bmPages, bmUpserted, steamProcessed, steamEnriched, backfilled, backfillFailed, backfillSkipped, elapsed }
}
