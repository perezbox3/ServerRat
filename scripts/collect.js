// PM2 runner for the background collector.
// Runs once per execution — PM2 cron_restart handles the 3-hour schedule.
import 'dotenv/config'
import { createDb } from '../server/db.js'
import { createSteamClient } from '../server/steam.js'
import { createA2sClient } from '../server/a2s.js'
import { runCollection } from '../server/collector.js'

const db = createDb(process.env.DB_PATH ?? './serverrat.db')

const steam = process.env.STEAM_API_KEY
  ? createSteamClient({ apiKey: process.env.STEAM_API_KEY })
  : null

const a2s = createA2sClient()

if (!steam) console.warn('[collector] STEAM_API_KEY not set — Steam phase will be skipped')

const result = await runCollection({ db, steam, a2s })
console.log('[collector] result:', JSON.stringify(result))
process.exit(0)
