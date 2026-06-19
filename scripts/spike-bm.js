// spike-bm.js — throwaway Task 1 probe. Goal: learn the BattleMetrics API shape.
// Run: node scripts/spike-bm.js
// Delete after findings are documented in docs/battlemetrics-findings.md

const BASE = 'https://api.battlemetrics.com'
const TOKEN = process.env.BATTLEMETRICS_TOKEN || ''

const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}

async function probe(label, url) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`PROBE: ${label}`)
  console.log(`URL:   ${url}`)
  console.log('='.repeat(60))
  const res = await fetch(url, { headers })
  console.log(`Status: ${res.status}`)
  const json = await res.json()
  console.log(JSON.stringify(json, null, 2))
  return json
}

// 1. Get one Rust server listing — see what fields come back
const list = await probe(
  'Server list (Rust, 1 result)',
  `${BASE}/servers?filter[game]=rust&page[size]=1`
)

const serverId = list?.data?.[0]?.id
if (!serverId) { console.log('\nNo server ID found — stopping.'); process.exit(1) }

console.log(`\nFound server ID: ${serverId}`)

// 2. Get full server detail — does it include wipe info?
await probe(
  'Server detail',
  `${BASE}/servers/${serverId}`
)

// 3. Try player count history — this is the key question
// BattleMetrics exposes: /servers/:id/player-count-history?start=...&stop=...
const now = new Date()
const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
await probe(
  'Player count history (7 days) — KEY QUESTION: does free tier allow this?',
  `${BASE}/servers/${serverId}/player-count-history?start=${weekAgo.toISOString()}&stop=${now.toISOString()}`
)
