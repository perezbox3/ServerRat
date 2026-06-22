// spike-steam.js — Task 1 risk probe
// Answers: how many Rust servers does Steam know about, what fields do we get,
// and can we join Steam↔BM on IP:port?
//
// Run: node scripts/spike-steam.js
import 'dotenv/config'

const STEAM_KEY = process.env.STEAM_API_KEY
if (!STEAM_KEY) { console.error('STEAM_API_KEY not set in .env'); process.exit(1) }

const RUST_APP_ID = 252490

// ── 1. Fetch server list from Steam ────────────────────────────────────────

console.log('\n── STEAM SERVER LIST ──')
const steamUrl = new URL('https://api.steampowered.com/IGameServersService/GetServerList/v1/')
steamUrl.searchParams.set('key', STEAM_KEY)
steamUrl.searchParams.set('filter', `\\appid\\${RUST_APP_ID}`)
steamUrl.searchParams.set('limit', '30000')  // ask for everything

const steamRes = await fetch(steamUrl.toString())
if (!steamRes.ok) {
  console.error('Steam API error:', steamRes.status, await steamRes.text())
  process.exit(1)
}
const steamJson = await steamRes.json()
const servers = steamJson.response?.servers ?? []

console.log(`Total Rust servers returned: ${servers.length}`)
console.log('\nFirst 5 raw entries:')
console.log(JSON.stringify(servers.slice(0, 5), null, 2))

// ── 2. Show available fields ────────────────────────────────────────────────

console.log('\n── FIELD INVENTORY (from first server) ──')
if (servers[0]) {
  for (const [k, v] of Object.entries(servers[0])) {
    console.log(`  ${k}: ${JSON.stringify(v)}`)
  }
}

// ── 3. Sample: highest-population servers ──────────────────────────────────

const topByPop = servers
  .filter(s => s.players > 0)
  .sort((a, b) => b.players - a.players)
  .slice(0, 10)

console.log('\n── TOP 10 BY CURRENT PLAYERS ──')
for (const s of topByPop) {
  console.log(`  ${s.addr.padEnd(22)} players:${String(s.players).padStart(4)}/${s.maxplayers}  "${s.name?.slice(0, 60)}"`)
}

// ── 4. BM join probe — check if BM exposes IP:port in raw JSON ─────────────
// BM server objects embed connection info in attributes.details.rust_addr or similar.
// Fetch one BM server and inspect its raw JSON to find the IP path.

console.log('\n── BM RAW FIELD PROBE (1 server) ──')
const bmUrl = new URL('https://api.battlemetrics.com/servers')
bmUrl.searchParams.set('filter[game]', 'rust')
bmUrl.searchParams.set('filter[status]', 'online')
bmUrl.searchParams.set('page[size]', '1')
bmUrl.searchParams.set('fields[server]', 'name,players,maxPlayers,rank,status,country,ip,port,details')

const bmRes = await fetch(bmUrl.toString())
if (!bmRes.ok) {
  console.error('BM API error:', bmRes.status)
} else {
  const bmJson = await bmRes.json()
  const raw = bmJson.data?.[0]
  if (raw) {
    console.log('BM attributes keys:', Object.keys(raw.attributes))
    console.log('BM ip:', raw.attributes.ip)
    console.log('BM port:', raw.attributes.port)
    console.log('BM name:', raw.attributes.name)
    console.log('BM details keys:', Object.keys(raw.attributes.details || {}))

    // ── 5. Attempt the join: find this BM server in the Steam list ──────────
    const bmIp = raw.attributes.ip
    const bmPort = raw.attributes.port
    const bmAddr = `${bmIp}:${bmPort}`
    console.log(`\n── JOIN PROBE: looking for BM addr ${bmAddr} in Steam list ──`)
    const steamMatch = servers.find(s => s.addr === bmAddr)
    if (steamMatch) {
      console.log('JOIN SUCCESS ✓')
      console.log('  Steam record:', JSON.stringify(steamMatch, null, 2))
    } else {
      // Steam may use a different query port vs game port — check if IP matches at least
      const ipMatches = servers.filter(s => s.addr?.startsWith(bmIp + ':'))
      console.log(`JOIN on exact addr: MISS. IP-only matches: ${ipMatches.length}`)
      if (ipMatches.length) {
        console.log('  BM port:', bmPort)
        console.log('  Steam ports for same IP:', ipMatches.map(s => s.addr.split(':')[1]))
      }
    }
  }
}

// ── 6. Summary stats ───────────────────────────────────────────────────────

const populated = servers.filter(s => s.players > 0).length
const vanilla = servers.filter(s => /vanilla/i.test(s.name)).length
const byRegion = {}
for (const s of servers) {
  const r = s.addr?.split('.')[0] === '192' ? 'LAN' : 'public'
  byRegion[r] = (byRegion[r] || 0) + 1
}

console.log('\n── SUMMARY ──')
console.log(`  Total servers:       ${servers.length}`)
console.log(`  With players > 0:    ${populated}`)
console.log(`  Name contains Vanilla: ${vanilla}`)
console.log('\nDone. Write findings to docs/steam-findings.md based on this output.')
