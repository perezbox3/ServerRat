const TARGETS = [1, 2, 3, 5, 7]

// Groups snapshots into numDays daily buckets starting from fromMs.
// Returns an array of length numDays where each entry is the average players
// for that day, or null if no data.
export function computeDailyAverages(snapshots, fromMs, numDays = 30) {
  const days = Array.from({ length: numDays }, () => [])
  for (const snap of snapshots) {
    const ms = Date.parse(snap.recorded_at)
    const idx = Math.floor((ms - fromMs) / 86400000)
    if (idx >= 0 && idx < numDays) days[idx].push(snap.players)
  }
  return days.map(arr =>
    arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
  )
}

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
