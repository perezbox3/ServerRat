// Background collector — runs outside the request path.
// Phase 1: crawl ALL BM pages slowly (1s sleep) → full server catalog.
// Phase 2: merge Steam catalog → enriches IP/port, adds Steam-only servers.

const sleep = ms => new Promise(r => setTimeout(r, ms))

const MAX_BM_PAGES = 200  // 200 × 100 = 20k servers max, well above real catalog size

export async function runCollection({ db, bm, steam = null, sleepMs = 1000 } = {}) {
  const started = Date.now()
  let bmPages = 0, bmUpserted = 0, steamProcessed = 0, steamEnriched = 0

  // ── Phase 1: BM full crawl ─────────────────────────────────────────────────
  console.log('[collector] BM crawl starting...')
  for (let page = 0; page < MAX_BM_PAGES; page++) {
    try {
      const batch = await bm.fetchPage(page)
      if (!batch.length) break
      for (const s of batch) db.upsertServer(s)
      bmUpserted += batch.length
      bmPages++
      process.stdout.write(`\r[collector] BM page ${page + 1}: ${bmUpserted} servers`)
      if (batch.length < 100) break
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

  const elapsed = Date.now() - started
  console.log(`[collector] complete in ${(elapsed / 1000).toFixed(1)}s`)
  return { bmPages, bmUpserted, steamProcessed, steamEnriched, elapsed }
}
