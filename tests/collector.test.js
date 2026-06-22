import { describe, it, expect, vi } from 'vitest'
import { createDb } from '../server/db.js'
import { runCollection } from '../server/collector.js'

function makeDb() { return createDb(':memory:') }

const steamServer1 = {
  steam_id: 'st-111', name: 'Alpha Server', ip: '1.2.3.4', query_port: 28017,
  game_port: 28015, current_players: 120, max_players: 200, map_name: 'Procedural Map',
  last_wipe: '2026-06-15T00:00:00Z', type: 'vanilla', group_limit: 'trio',
  wipe_day: 'Thursday', wipe_freq: 'biweekly', queue: 5,
}
const steamServer2 = {
  steam_id: 'st-222', name: 'Beta Server', ip: '5.6.7.8', query_port: 28017,
  game_port: 28015, current_players: 80, max_players: 150, map_name: 'Procedural Map',
  last_wipe: '2026-06-10T00:00:00Z', type: '2x', group_limit: 'duo',
  wipe_day: 'Monday', wipe_freq: 'weekly', queue: 0,
}

function makeSteam(servers = [steamServer1, steamServer2]) {
  return { listRustServers: vi.fn(async () => servers) }
}

function makeA2s(enrichData = {}) {
  return {
    enrichBatch: vi.fn(async (servers) => {
      const results = new Map()
      for (const { id } of servers) {
        results.set(id, enrichData[id] ?? null)
      }
      return results
    }),
  }
}

describe('runCollection — Phase 1 (Steam)', () => {
  it('upserts all servers from Steam', async () => {
    const db = makeDb()
    await runCollection({ db, steam: makeSteam() })
    expect(db.getServer('steam_st-111')).not.toBeNull()
    expect(db.getServer('steam_st-222')).not.toBeNull()
  })

  it('writes one snapshot per server with non-null players', async () => {
    const db = makeDb()
    await runCollection({ db, steam: makeSteam() })
    expect(db.getSnapshots('steam_st-111')).toHaveLength(1)
    expect(db.getSnapshots('steam_st-222')).toHaveLength(1)
  })

  it('snapshot player count matches Steam data', async () => {
    const db = makeDb()
    await runCollection({ db, steam: makeSteam() })
    const snap = db.getSnapshots('steam_st-111')[0]
    expect(snap.players).toBe(120)
  })

  it('does not write snapshot when current_players is null', async () => {
    const db = makeDb()
    const noPlayers = { ...steamServer1, current_players: null }
    await runCollection({ db, steam: makeSteam([noPlayers]) })
    expect(db.getSnapshots('steam_st-111')).toHaveLength(0)
  })

  it('skips Steam phase when no steam client given', async () => {
    const db = makeDb()
    const result = await runCollection({ db })
    expect(result.steamUpserted).toBe(0)
    expect(result.snapshotsWritten).toBe(0)
  })

  it('returns steam stats', async () => {
    const db = makeDb()
    const result = await runCollection({ db, steam: makeSteam() })
    expect(result.steamUpserted).toBe(2)
    expect(result.snapshotsWritten).toBe(2)
    expect(typeof result.elapsed).toBe('number')
  })
})

describe('runCollection — Phase 2 (A2S enrichment)', () => {
  it('calls enrichBatch with servers that have ip + query_port + players > 0', async () => {
    const db = makeDb()
    const a2s = makeA2s()
    await runCollection({ db, steam: makeSteam(), a2s })
    expect(a2s.enrichBatch).toHaveBeenCalledOnce()
    const [candidates] = a2s.enrichBatch.mock.calls[0]
    // both servers have ip + query_port + players > 0
    expect(candidates.length).toBe(2)
    expect(candidates.every(c => c.ip && c.query_port)).toBe(true)
  })

  it('writes A2S data back to the server row', async () => {
    const db = makeDb()
    const a2sData = {
      map_seed: 12345, map_size: 4250,
      description: 'Great server', last_wipe: '2026-06-15T00:00:00Z',
      wipe_day: 'Thursday', wipe_freq: 'biweekly', type: 'vanilla',
    }
    const a2s = makeA2s({ 'steam_st-111': a2sData })
    await runCollection({ db, steam: makeSteam([steamServer1]), a2s })
    const row = db.getServer('steam_st-111')
    expect(row.map_seed).toBe(12345)
    expect(row.map_size).toBe(4250)
    expect(row.description).toBe('Great server')
  })

  it('counts enriched and unreachable separately', async () => {
    const db = makeDb()
    const a2s = makeA2s({ 'steam_st-111': { map_seed: 1, map_size: 2 } })
    const result = await runCollection({ db, steam: makeSteam(), a2s })
    expect(result.a2sEnriched).toBe(1)
    expect(result.a2sFailed).toBe(1)
  })

  it('skips A2S phase when no a2s client given', async () => {
    const db = makeDb()
    const result = await runCollection({ db, steam: makeSteam() })
    expect(result.a2sEnriched).toBe(0)
  })

  it('skips A2S enrichment entirely when no servers have players > 0', async () => {
    const db = makeDb()
    const zeroPlayers = { ...steamServer1, current_players: 0 }
    const a2s = makeA2s()
    const result = await runCollection({ db, steam: makeSteam([zeroPlayers]), a2s })
    expect(a2s.enrichBatch).not.toHaveBeenCalled()
    expect(result.a2sEnriched).toBe(0)
  })
})
