import { createBmClient } from '../server/battlemetrics.js'
import { computePopulationCurve } from '../server/curve.js'

const bm = createBmClient()

const servers = await bm.listRustServers({ country: 'US' })
console.log(`Fetched ${servers.length} servers`)

const s = servers[0]
console.log(`First: ${s.name} | type=${s.type} | players=${s.current_players}/${s.max_players} | wipe_day=${s.wipe_day}`)

const target = servers.find(sv => sv.last_wipe)
if (target) {
  const start = target.last_wipe
  const stop = new Date(new Date(start).getTime() + 8 * 86400000).toISOString()
  console.log(`\nFetching history for "${target.name}" (${target.id}) — wipe: ${start}`)
  const history = await bm.getServerHistory(target.id, { start, stop })
  console.log(`History points: ${history.length}`)
  if (history.length) {
    const curve = computePopulationCurve(history, start)
    console.log('Curve:', JSON.stringify(curve, null, 2))
  }
} else {
  console.log('No server with last_wipe in first page')
}
