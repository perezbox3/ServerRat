// Background collector — runs outside the request path.
// Phase 1: Steam API → full Rust server catalog + current player snapshots.
// Phase 2: A2S_RULES enrichment → fills seed/size/description/wipe for active servers.

// Bucket snapshot timestamps to the nearest hour so the unique index on
// (server_id, recorded_at) deduplicates if the collector runs more than once
// in a single hour window.
function snapshotBucket() {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  return d.toISOString()
}

const A2S_CAP = 3000  // max servers to enrich per run

export async function runCollection({ db, steam = null, a2s = null } = {}) {
  const started = Date.now()
  let steamUpserted = 0, snapshotsWritten = 0, a2sEnriched = 0, a2sFailed = 0

  // ── Phase 1: Steam catalog + snapshots ────────────────────────────────────
  if (steam) {
    console.log('[collector] Steam catalog starting...')
    try {
      const servers = await steam.listRustServers()
      const bucket = snapshotBucket()
      for (const s of servers) {
        try {
          const serverId = db.upsertSteamServer(s)
          if (serverId && s.current_players != null) {
            db.addSnapshot({ server_id: serverId, recorded_at: bucket, players: s.current_players })
            snapshotsWritten++
          }
          steamUpserted++
        } catch (e) {
          console.warn(`[collector] skip ${s.steam_id}: ${e.message}`)
        }
      }
      console.log(`[collector] Steam done — ${steamUpserted} servers, ${snapshotsWritten} snapshots`)
    } catch (e) {
      console.error('[collector] Steam failed:', e.message)
    }
  } else {
    console.warn('[collector] No Steam client — skipping Phase 1')
  }

  // ── Phase 2: A2S_RULES enrichment ─────────────────────────────────────────
  // Query active servers (players > 0) that have an IP + query port.
  // This fills seed/size/description and refines wipe metadata from the
  // server itself rather than relying on name parsing.
  if (a2s) {
    const candidates = db.listServersForA2sEnrichment({ cap: A2S_CAP })
    console.log(`[collector] A2S enrichment: ${candidates.length} candidates`)

    if (candidates.length > 0) {
      const results = await a2s.enrichBatch(candidates, {
        onProgress: (done, total) => process.stdout.write(`\r[collector] A2S ${done}/${total}`),
      })
      console.log()

      for (const { id } of candidates) {
        const data = results.get(id)
        if (data) {
          db.updateA2sData(id, data)
          a2sEnriched++
        } else {
          a2sFailed++
        }
      }
      console.log(`[collector] A2S done — ${a2sEnriched} enriched, ${a2sFailed} unreachable`)
    }
  }

  const elapsed = Date.now() - started
  console.log(`[collector] complete in ${(elapsed / 1000).toFixed(1)}s`)
  return { steamUpserted, snapshotsWritten, a2sEnriched, a2sFailed, elapsed }
}
