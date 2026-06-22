import { Router } from 'express'
import { computePopulationCurve } from '../curve.js'
import { rankServers } from '../filter.js'
import { sanitize } from './validate.js'

export function createMatchRouter({ db }) {
  const router = Router()

  router.post('/', (req, res) => {
    try {
      const criteria = sanitize(req.body ?? {})
      const servers = db.listServers({})
      const withCurves = servers.map(s => ({
        ...s,
        curve: s.last_wipe
          ? computePopulationCurve(db.getSnapshots(s.id), s.last_wipe)
          : null,
      }))
      res.json(rankServers(withCurves, criteria))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
