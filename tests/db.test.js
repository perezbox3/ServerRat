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
