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

function makeBm(pages = [[server1], [server2]]) {
  let call = 0
  return {
    fetchPage: vi.fn(async () => pages[call++] ?? []),
  }
}

describe('runCollection', () => {
  it('upserts all servers from BM pages', async () => {
    const db = makeDb()
    // Two servers on page 0 (<100) → collector stops; both must be in DB
    const bm = makeBm([[server1, server2]])
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.fetchPage).toHaveBeenCalledTimes(1)
    expect(db.getServer('bm-1')).not.toBeNull()
    expect(db.getServer('bm-2')).not.toBeNull()
  })

  it('stops pagination when a page returns fewer than 100 entries', async () => {
    const db = makeDb()
    const bm = makeBm([[server1]])  // 1 server = < 100
    await runCollection({ db, bm, sleepMs: 0 })
    expect(bm.fetchPage).toHaveBeenCalledTimes(1)
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
      fetchPage: vi.fn(async () => {
        if (call++ === 0) return [server1]
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

  it('returns collection stats', async () => {
    const db = makeDb()
    const bm = makeBm([[server1, server2]])
    const result = await runCollection({ db, bm, sleepMs: 0 })
    expect(result.bmPages).toBe(1)
    expect(result.bmUpserted).toBe(2)
    expect(typeof result.elapsed).toBe('number')
  })
})
