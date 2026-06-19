const TARGETS = [1, 2, 3, 5, 7]

function nearestTarget(dayOffset) {
  let best = TARGETS[0]
  let bestDist = Infinity
  for (const t of TARGETS) {
    const dist = Math.abs(dayOffset - t)
    if (dist < bestDist || (dist === bestDist && t > best)) {
      best = t
      bestDist = dist
    }
  }
  return best
}

export function computePopulationCurve(snapshots, wipeTime) {
  const wipeMs = Date.parse(wipeTime)
  const buckets = Object.fromEntries(TARGETS.map(d => [d, []]))

  for (const snap of snapshots) {
    const ms = Date.parse(snap.recorded_at)
    if (ms < wipeMs) continue
    const dayOffset = (ms - wipeMs) / 86400000
    buckets[nearestTarget(dayOffset)].push(snap.players)
  }

  const result = {}
  for (const day of TARGETS) {
    const arr = buckets[day]
    result[`day${day}`] = arr.length > 0
      ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
      : null
  }

  result.retention = (result.day1 && result.day3)
    ? result.day3 / result.day1
    : null

  return result
}
