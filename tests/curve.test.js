import { describe, it, expect } from 'vitest'
import { computePopulationCurve } from '../server/curve.js'

const wipe = '2026-06-01T00:00:00Z'

function snap(dayOffset, players) {
  const t = new Date(Date.parse(wipe) + dayOffset * 86400000).toISOString()
  return { recorded_at: t, players }
}

describe('computePopulationCurve', () => {
  it('buckets snapshots into day1/2/3/5/7 averages relative to wipe', () => {
    const snaps = [snap(0.5, 300), snap(1.5, 200), snap(2.5, 90), snap(5.2, 30), snap(7.1, 10)]
    const curve = computePopulationCurve(snaps, wipe)
    expect(curve.day1).toBe(300)
    expect(curve.day2).toBe(200)
    expect(curve.day3).toBe(90)
    expect(curve.day5).toBe(30)
    expect(curve.day7).toBe(10)
  })

  it('averages multiple snapshots in the same day bucket', () => {
    const snaps = [snap(0.2, 100), snap(0.8, 200)]
    expect(computePopulationCurve(snaps, wipe).day1).toBe(150)
  })

  it('returns null for a day with no data', () => {
    const curve = computePopulationCurve([snap(0.5, 300)], wipe)
    expect(curve.day1).toBe(300)
    expect(curve.day7).toBeNull()
  })

  it('ignores snapshots before the wipe', () => {
    const snaps = [snap(-1, 999), snap(0.5, 300)]
    expect(computePopulationCurve(snaps, wipe).day1).toBe(300)
  })

  it('computes a retention ratio (day3 / day1)', () => {
    const curve = computePopulationCurve([snap(0.5, 300), snap(2.5, 90)], wipe)
    expect(curve.retention).toBeCloseTo(0.3)
  })
})
