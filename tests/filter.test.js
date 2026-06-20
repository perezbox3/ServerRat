import { describe, it, expect } from 'vitest'
import { filterServers, scoreMatch, rankServers } from '../server/filter.js'

const thursday = {
  id: '1', name: 'Alpha', type: '2x', wipe_day: 'Thursday', wipe_freq: 'biweekly',
  group_limit: 'trio', region: 'US', current_players: 80,
  curve: { day1: 300, day2: 250, day3: 270, day5: 200, day7: 150, retention: 0.9 },
}
const noWipe = {
  id: '2', name: 'Beta', type: 'vanilla', wipe_day: null, wipe_freq: null,
  group_limit: 'any', region: 'US', current_players: 200,
  curve: null,
}
const friday = {
  id: '3', name: 'Gamma', type: '5x', wipe_day: 'Friday', wipe_freq: 'weekly',
  group_limit: 'quad', region: 'EU', current_players: 50,
  curve: { day1: 100, day2: 80, day3: null, day5: null, day7: null, retention: null },
}
const fixtures = [thursday, noWipe, friday]

describe('filterServers', () => {
  it('returns all servers when criteria is empty', () => {
    expect(filterServers(fixtures, {})).toHaveLength(3)
  })

  it('AND-combines two criteria to return exactly one match', () => {
    const result = filterServers(fixtures, { wipe_day: 'Thursday', type: '2x' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('excludes a null-wipe-day server when wipe_day is specified', () => {
    const ids = filterServers(fixtures, { wipe_day: 'Thursday' }).map(s => s.id)
    expect(ids).not.toContain('2')
  })

  it('includes a null-wipe-day server when wipe_day is not specified', () => {
    const ids = filterServers(fixtures, { type: 'vanilla' }).map(s => s.id)
    expect(ids).toContain('2')
  })

  it('matches a group_limit: any server against a specific group_limit filter', () => {
    const ids = filterServers(fixtures, { group_limit: 'solo' }).map(s => s.id)
    expect(ids).toContain('2')
  })
})

describe('scoreMatch', () => {
  it('returns the retention from the curve and current_players from the server', () => {
    const score = scoreMatch(thursday, thursday.curve)
    expect(score.retention).toBe(0.9)
    expect(score.players).toBe(80)
  })

  it('returns null retention when curve is null', () => {
    const score = scoreMatch(noWipe, null)
    expect(score.retention).toBeNull()
  })

  it('returns null retention when curve.retention is null', () => {
    const score = scoreMatch(friday, friday.curve)
    expect(score.retention).toBeNull()
  })
})

describe('rankServers', () => {
  it('places servers with real retention above null-retention servers', () => {
    const ranked = rankServers(fixtures, {})
    expect(ranked[0].id).toBe('1')
  })

  it('among null-retention servers, sorts by current_players DESC', () => {
    const ranked = rankServers(fixtures, {})
    expect(ranked[1].id).toBe('2') // 200 players
    expect(ranked[2].id).toBe('3') // 50 players
  })

  it('filters before sorting — wipe_day filter returns only the Thursday server', () => {
    const ranked = rankServers(fixtures, { wipe_day: 'Thursday' })
    expect(ranked).toHaveLength(1)
    expect(ranked[0].id).toBe('1')
  })
})
