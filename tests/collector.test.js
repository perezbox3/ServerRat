import { describe, it, expect, vi } from 'vitest'
import { createDb } from '../server/db.js'
import { runCollection } from '../server/collector.js'

function makeDb() { return createDb(':memory:') }

const server1 = {
  id: 'bm-1', steam_id: 'steam-111', name: 'Test Server', region: 'US', type: '2x',
  wipe_day: 'Thursday', wipe_freq: 'biweekly', group_limit: 'trio',
  current_players: 120, max_players: 200, last_wipe: '2026-06-15T00:00:00Z',
  next_wipe: null, ip: '1.2.3.4', queue: 0, map_seed: null, map_size: null, raw: '{}',
}
const server2 = {
  id: 'bm-2', steam_id: 'steam-222', name: 'Server Two', region: 'EU', type: 'vanilla',
  wipe_day: 'Monday', wipe_freq: 'monthly', group_limit: 'any',
  current_players: 80, max_players: 150, last_wipe: '2026-06-10T00:00:00Z',
  next_wipe: null, ip: '5.6.7.8', queue: 0, map_seed: null, map_size: null, raw: '{}',
}

// makeBm now uses fetchPageCursor, which returns { servers, nextUrl }.
// nextUrl=null on the last page signals the collector to stop.
function makeBm(pages = [[server1], [server2]], historyPoints = []) {
  let call = 0
  return {
    fetchPageCursor: vi.fn(async () => {
      const servers = pages[call++] ?? []
      return { servers, nextUrl: call < pages.length ? 'https://fake.next' : null }
    }),
    getServerHistory: vi.fn(async () => historyPoints),
  }
}

describe('runCollection', () => {
  it('upserts all servers from BM pages', async () => {
    const db = makeDb()
    // Two servers on page 0 (<100) → nextUrl null → collector stops
    const bm = makeBm([[server1, server2]])
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.fetchPageCursor).toHaveBeenCalledTimes(1)
    expect(db.getServer('bm-1')).not.toBeNull()
    expect(db.getServer('bm-2')).not.toBeNull()
  })

  it('stops pagination when a page returns fewer than 100 entries', async () => {
    const db = makeDb()
    const bm = makeBm([[server1]])  // 1 server = < 100 → stop
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.fetchPageCursor).toHaveBeenCalledTimes(1)
  })

  it('touches servers-list cache after BM crawl', async () => {
    const db = makeDb()
    const bm = makeBm([[]])
    await runCollection({ db, bm, sleepMs: 0 })
    expect(db.isStale('servers-list', 300)).toBe(false)
  })

  it('continues if a BM page throws — upserts what was already fetched', async () => {
    const db = makeDb()
    let call = 0
    const bm = {
      fetchPageCursor: vi.fn(async () => {
        if (call++ === 0) return { servers: [server1], nextUrl: 'https://fake.next' }
        throw new Error('BM 429')
      }),
    }
    await runCollection({ db, bm, sleepMs: 0 })
    expect(db.getServer('bm-1')).not.toBeNull()
  })

  it('runs Steam phase when steam client is provided', async () => {
    const db = makeDb()
    const bm = makeBm([[server1]])
    const steamServer = {
      steam_id: 'steam-111', name: 'Test Server', ip: '1.2.3.4', game_port: 28015,
      current_players: 125, max_players: 200, map_name: 'Procedural Map',
      last_wipe: null, type: null, group_limit: 'trio', queue: 5,
    }
    const steam = { listRustServers: vi.fn(async () => [steamServer]) }
    db.upsertServer(server1)  // pre-seed so Steam can enrich it
    await runCollection({ db, bm, steam, sleepMs: 0 })
    expect(steam.listRustServers).toHaveBeenCalledOnce()
    // Steam should have enriched the game_port
    expect(db.getServer('bm-1').game_port).toBe(28015)
  })

  it('skips Steam phase when no steam client given', async () => {
    const db = makeDb()
    const bm = makeBm([[server1]])
    const result = await runCollection({ db, bm, sleepMs: 0 })
    expect(result.steamProcessed).toBe(0)
  })

  it('passes cursor URL from previous page to next fetchPageCursor call', async () => {
    const db = makeDb()
    // Two full pages (100 each would be realistic, but 2+1 shows the cursor is passed)
    const page0 = Array(100).fill(null).map((_, i) => ({ ...server1, id: `bm-p0-${i}`, steam_id: `s0${i}`, raw: '{}' }))
    const page1 = [server2]
    let calls = []
    const bm = {
      fetchPageCursor: vi.fn(async (cursorUrl) => {
        calls.push(cursorUrl)
        if (calls.length === 1) return { servers: page0, nextUrl: 'https://fake.cursor' }
        return { servers: page1, nextUrl: null }
      }),
    }
    await runCollection({ db, bm, sleepMs: 0 })
    expect(calls[0]).toBeNull()
    expect(calls[1]).toBe('https://fake.cursor')
    expect(db.getServer('bm-2')).not.toBeNull()
  })

  it('returns collection stats', async () => {
    const db = makeDb()
    const bm = makeBm([[server1, server2]])
    const result = await runCollection({ db, bm, sleepMs: 0 })
    expect(result.bmPages).toBe(1)
    expect(result.bmUpserted).toBe(2)
    expect(typeof result.elapsed).toBe('number')
  })
})

// ── Phase 3: history backfill ────────────────────────────────────────────────

const wipeTime = '2026-06-15T00:00:00Z'
// Synthetic hourly snapshots spanning day1–day3 post-wipe
const fakeHistory = Array.from({ length: 72 }, (_, i) => ({
  recorded_at: new Date(new Date(wipeTime).getTime() + i * 3600000).toISOString(),
  players: 100 - i,  // declines over time
}))

const bmServer = {
  ...server1, id: 'bm-10', current_players: 50, last_wipe: wipeTime, raw: '{}',
}
const steamServer = {
  ...server1, id: 'steam_999', steam_id: 'steam-999', current_players: 50,
  last_wipe: wipeTime, raw: '{}',
}

describe('Phase 3 — history backfill', () => {
  it('calls getServerHistory for BM servers, not for steam_ servers', async () => {
    const db = makeDb()
    db.upsertServer(bmServer)
    db.upsertServer(steamServer)
    const bm = makeBm([[]], fakeHistory)
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.getServerHistory).toHaveBeenCalledWith('bm-10', expect.any(Object))
    const calls = bm.getServerHistory.mock.calls.map(c => c[0])
    expect(calls).not.toContain('steam_999')
  })

  it('writes snapshots into the DB for the backfilled server', async () => {
    const db = makeDb()
    db.upsertServer(bmServer)
    const bm = makeBm([[]], fakeHistory)
    await runCollection({ db, bm, sleepMs: 0 })
    const snaps = db.getSnapshots('bm-10')
    expect(snaps.length).toBe(fakeHistory.length)
  })

  it('computes and stores retention after backfill', async () => {
    const db = makeDb()
    db.upsertServer(bmServer)
    const bm = makeBm([[]], fakeHistory)
    await runCollection({ db, bm, sleepMs: 0 })
    const row = db.getServer('bm-10')
    expect(row.retention).not.toBeNull()
    expect(typeof row.retention).toBe('number')
  })

  it('skips servers already in the history cache (not stale)', async () => {
    const db = makeDb()
    db.upsertServer(bmServer)
    db.touchCache('history:bm-10')   // mark as fresh
    const bm = makeBm([[]], fakeHistory)
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.getServerHistory).not.toHaveBeenCalled()
  })

  it('skips servers below the population floor', async () => {
    const db = makeDb()
    const deadServer = { ...bmServer, id: 'bm-dead', current_players: 2 }
    db.upsertServer(deadServer)
    const bm = makeBm([[]], fakeHistory)
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.getServerHistory).not.toHaveBeenCalled()
  })

  it('skips servers with null last_wipe', async () => {
    const db = makeDb()
    const noWipe = { ...bmServer, id: 'bm-nowipe', last_wipe: null }
    db.upsertServer(noWipe)
    const bm = makeBm([[]], fakeHistory)
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.getServerHistory).not.toHaveBeenCalled()
  })

  it('continues sweep when one server history call fails', async () => {
    const db = makeDb()
    const bmA = { ...bmServer, id: 'bm-a', steam_id: 'st-a', current_players: 50 }
    const bmB = { ...bmServer, id: 'bm-b', steam_id: 'st-b', current_players: 40 }
    db.upsertServer(bmA)
    db.upsertServer(bmB)
    let calls = 0
    const bm = {
      fetchPageCursor: vi.fn(async () => ({ servers: [], nextUrl: null })),
      getServerHistory: vi.fn(async (id) => {
        calls++
        if (id === 'bm-a') throw new Error('BattleMetrics 400')
        return fakeHistory
      }),
    }
    await runCollection({ db, bm, sleepMs: 0 })
    expect(calls).toBe(2)
    expect(db.getSnapshots('bm-b').length).toBe(fakeHistory.length)
  })

  it('returns backfill stats', async () => {
    const db = makeDb()
    db.upsertServer(bmServer)
    const bm = makeBm([[]], fakeHistory)
    const result = await runCollection({ db, bm, sleepMs: 0 })
    expect(result.backfilled).toBe(1)
    expect(result.backfillFailed).toBe(0)
    expect(typeof result.backfillSkipped).toBe('number')
  })
})
