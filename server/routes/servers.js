import { Router } from 'express'
import { computePopulationCurve } from '../curve.js'
import { sanitize } from './validate.js'

const HISTORY_TTL = 3600

function toHealth(retention) {
  if (retention == null) return 'unknown'
  if (retention >= 0.7) return 'healthy'
  if (retention >= 0.4) return 'fading'
  return 'dying'
}

export function createServersRouter({ db, bm }) {
  const router = Router()
  const listTtl = parseInt(process.env.CACHE_TTL_SECONDS ?? '300', 10)

  router.get('/', async (req, res) => {
    try {
      if (db.isStale('servers-list', listTtl)) {
        const servers = await bm.listRustServers()
        for (const s of servers) db.upsertServer(s)
        db.touchCache('servers-list')
      }
      res.json(db.listServers(sanitize(req.query)))
    } catch {
      res.status(502).json({ error: 'upstream error' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const server = db.getServer(req.params.id)
      if (!server) return res.status(404).json({ error: 'not found' })

      const cacheKey = 'history:' + server.id
      if (db.isStale(cacheKey, HISTORY_TTL)) {
        const start = server.last_wipe
          ?? new Date(Date.now() - 8 * 86400000).toISOString()
        const stop = new Date(
          Math.min(Date.now(), new Date(start).getTime() + 8 * 86400000)
        ).toISOString()
        const history = await bm.getServerHistory(server.id, { start, stop })
        for (const pt of history) db.addSnapshot({ server_id: server.id, ...pt })
        db.touchCache(cacheKey)
      }

      let curve = null
      if (server.last_wipe) {
        const obj = computePopulationCurve(db.getSnapshots(server.id), server.last_wipe)
        curve = {
          values: [obj.day1, obj.day2, obj.day3, obj.day5, obj.day7],
          health: toHealth(obj.retention),
          retention: obj.retention,
        }
      }

      res.json({ ...server, curve })
    } catch {
      res.status(502).json({ error: 'upstream error' })
    }
  })

  return router
}
