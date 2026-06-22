import { createBmClient } from '../server/battlemetrics.js'
import { computePopulationCurve } from '../server/curve.js'

const bm = createBmClient()
const SAMPLE_SIZE = 15

const servers = await bm.listRustServers()
console.log(`Fetched ${servers.length} servers`)

const withWipe = servers.filter(s => s.last_wipe)
const noWipe = servers.length - withWipe.length
console.log(`  ${withWipe.length} have last_wipe   ${noWipe} do not`)

const sample = withWipe.slice(0, SAMPLE_SIZE)
console.log(`\nSampling ${sample.length} servers for population history...\n`)

let nonNull = 0
let nullRetention = 0
let historyEmpty = 0

for (const s of sample) {
  const start = s.last_wipe
  const stop = new Date(new Date(start).getTime() + 8 * 86400000).toISOString()
  const history = await bm.getServerHistory(s.id, { start, stop })
  const curve = computePopulationCurve(history, start)
  const tag = curve.retention !== null
    ? `retention=${curve.retention.toFixed(2)} day1=${curve.day1} day3=${curve.day3}`
    : `retention=null  day1=${curve.day1 ?? '-'} day3=${curve.day3 ?? '-'} (${history.length} pts)`

  console.log(`  [${curve.retention !== null ? 'OK  ' : 'NULL'}] ${s.name.slice(0, 40).padEnd(40)} ${tag}`)

  if (curve.retention !== null) nonNull++
  else if (history.length === 0) historyEmpty++
  else nullRetention++
}

console.log(`
── VERDICT ─────────────────────────────────────
  Non-null retention : ${nonNull} / ${sample.length} (${Math.round(nonNull / sample.length * 100)}%)
  Null retention     : ${nullRetention}  (history exists but day1 or day3 is empty)
  No history at all  : ${historyEmpty}
`)

if (nonNull / sample.length >= 0.4) {
  console.log('GREEN — enough servers have retention for meaningful ranking.')
} else {
  console.log('YELLOW/RED — too few servers have retention; ranking assumption may need revisiting.')
}
