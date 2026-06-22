import 'dotenv/config'
import { createApp } from './app.js'
import { createDb } from './db.js'

const PORT = process.env.PORT || 3003
const db = createDb(process.env.DB_PATH ?? './serverrat.db')
const app = createApp({ db })
app.listen(PORT, () => console.log(`ServerRat listening on ${PORT}`))
if (!process.env.STEAM_API_KEY) console.warn('[server] STEAM_API_KEY not set — collector Steam phase will be skipped')
