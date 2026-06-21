import express from 'express'
import { createServersRouter } from './routes/servers.js'
import { createMatchRouter } from './routes/match.js'

export function createApp({ db, bm } = {}) {
  const app = express()
  app.use(express.json())
  app.use(express.static('public'))
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api/servers', createServersRouter({ db, bm }))
  app.use('/api/match', createMatchRouter({ db, bm }))
  return app
}
