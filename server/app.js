import express from 'express'
import { createServersRouter } from './routes/servers.js'
import { createMatchRouter } from './routes/match.js'

export function createApp({ db } = {}) {
  const app = express()
  app.use(express.json())
  app.use(express.static('public'))
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api/servers', createServersRouter({ db }))
  app.use('/api/match', createMatchRouter({ db }))
  return app
}
