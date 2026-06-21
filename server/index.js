import 'dotenv/config'
import { createApp } from './app.js'
import { createDb } from './db.js'
import { createBmClient } from './battlemetrics.js'

const PORT = process.env.PORT || 3003
const db = createDb(process.env.DB_PATH ?? './serverrat.db')
const bm = createBmClient({
  baseUrl: process.env.BM_BASE_URL ?? 'https://api.battlemetrics.com',
  token: process.env.BATTLEMETRICS_TOKEN ?? null,
})
const app = createApp({ db, bm })
app.listen(PORT, () => console.log(`ServerRat listening on ${PORT}`))
