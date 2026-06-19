import express from 'express'

export function createApp({ db, bm } = {}) {
  const app = express()
  app.use(express.json())
  app.use(express.static('public'))

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  return app
}
