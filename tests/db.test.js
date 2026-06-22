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

  it('filters by name substring when search is provided', () => {
    db.upsertServer({ id: 'a', name: 'Vanilla Land', raw: '{}' })
    db.upsertServer({ id: 'b', name: 'Rusty Trio', raw: '{}' })
    const result = db.listServers({ search: 'vanilla' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('sorts by retention DESC (nulls last) when sort=retention', () => {
    db.upsertServer({ id: 'a', name: 'A', current_players: 100, raw: '{}' })
    db.upsertServer({ id: 'b', name: 'B', current_players: 200, raw: '{}' })
    db.upsertServer({ id: 'c', name: 'C', current_players: 50, raw: '{}' })
    db.updateRetention('a', 0.8)
    db.updateRetention('b', 0.3)
    // c has no retention
    const result = db.listServers({ sort: 'retention' })
    expect(result[0].id).toBe('a')
    expect(result[1].id).toBe('b')
    expect(result[2].id).toBe('c')
  })
})

describe('updateRetention', () => {
  it('stores retention on an existing server', () => {
    db.upsertServer({ id: 'a', name: 'A', raw: '{}' })
    db.updateRetention('a', 0.72)
    expect(db.getServer('a').retention).toBeCloseTo(0.72)
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
