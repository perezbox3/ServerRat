// PM2 runner for the background collector.
// Runs once per execution — PM2 cron_restart handles the schedule.
import 'dotenv/config'
import { createDb } from '../server/db.js'
import { createBmClient } from '../server/battlemetrics.js'
import { createSteamClient } from '../server/steam.js'
import { runCollection } from '../server/collector.js'

const db = createDb(process.env.DB_PATH ?? './serverrat.db')
const bm = createBmClient({
  baseUrl: process.env.BM_BASE_URL ?? 'https://api.battlemetrics.com',
  token: process.env.BATTLEMETRICS_TOKEN ?? null,
})

const steam = process.env.STEAM_API_KEY
  ? createSteamClient({ apiKey: process.env.STEAM_API_KEY })
  : null

if (!steam) console.warn('[collector] STEAM_API_KEY not set — skipping Steam phase')

const result = await runCollection({ db, bm, steam })
console.log('[collector] result:', JSON.stringify(result))
process.exit(0)
