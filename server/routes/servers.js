import { Router } from 'express'
import { computePopulationCurve, computeDailyAverages } from '../curve.js'
import { sanitize } from './validate.js'

function toHealth(retention) {
  if (retention == null) return 'unknown'
  if (retention >= 0.7) return 'healthy'
  if (retention >= 0.4) return 'fading'
  return 'dying'
}

export function createServersRouter({ db }) {
  const router = Router()

  // List is populated by the background collector — this route is a pure DB read.
  router.get('/', (req, res) => {
    try {
      const filters = sanitize(req.query)
      const { page, limit } = filters
      const servers = db.listServers(filters)
      const total = db.countServers(filters)
      res.json({ servers, total, page, limit })
    } catch (e) {
      console.error('[servers] list error:', e.message)
      res.status(502).json({ error: 'upstream error' })
    }
  })

  router.get('/:id', (req, res) => {
    try {
      const server = db.getServer(req.params.id)
      if (!server) return res.status(404).json({ error: 'not found' })

      const snapshots = db.getSnapshots(server.id)

      // Current-wipe curve
      let curve = null
      if (server.last_wipe) {
        const obj = computePopulationCurve(snapshots, server.last_wipe)
        curve = {
          values: [obj.day1, obj.day2, obj.day3, obj.day5, obj.day7],
          health: toHealth(obj.retention),
          retention: obj.retention,
        }
        // Persist retention so the list endpoint can sort by it over time
        if (obj.retention !== null) db.updateRetention(server.id, obj.retention)
      }

      // 30-day daily averages for the bar chart
      const fromMs = Date.now() - 30 * 86400000
      const pop30 = computeDailyAverages(snapshots, fromMs)

      // Wipe history — compute a curve for each prior wipe within our 30-day window
      const CADENCE_MS = { weekly: 7, biweekly: 14, monthly: 30 }
      const wipe_history = []
      if (server.last_wipe && server.wipe_freq) {
        const cadMs = (CADENCE_MS[server.wipe_freq] ?? 7) * 86400000
        for (let k = 0; k < 5; k++) {
          const wipeMs = new Date(server.last_wipe).getTime() - k * cadMs
          if (wipeMs < Date.now() - 31 * 86400000) break
          const wipeTime = new Date(wipeMs).toISOString()
          const nextWipeMs = wipeMs + cadMs
          // Only use snapshots within this wipe's window
          const wipeSnaps = snapshots.filter(s => {
            const ms = Date.parse(s.recorded_at)
            return ms >= wipeMs && ms < nextWipeMs
          })
          const c = computePopulationCurve(wipeSnaps, wipeTime)
          if (c.day1 !== null) {
            wipe_history.push({
              wipe_date: wipeTime,
              peak: c.day1,
              day3: c.day3,
              retention: c.retention,
            })
          }
        }
      }

      res.json({ ...server, curve, pop30, wipe_history })
    } catch {
      res.status(502).json({ error: 'upstream error' })
    }
  })

  return router
}
