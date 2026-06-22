import { parseTitle } from './parse.js'

// Re-export so existing imports from battlemetrics.js keep working.
export { parseTitle }

const DAY_NAMES = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
  FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
}

// Returns the server type only when BM has explicit structured evidence.
// 'community' and 'modded' are too generic — let title parsing override them.
function deriveTypeStrict(details, settings) {
  if (details.official) return 'official'
  const gather = settings.rates?.gather
  if (typeof gather === 'number') {
    if (gather === 1) return 'vanilla'
    if (gather === 2) return '2x'
    if (gather === 5) return '5x'
    if (gather === 10) return '10x'
    return `${gather}x`
  }
  const t = details.rust_type
  if (t && t !== 'community' && t !== 'modded') return t
  return null
}

function deriveType(details, settings) {
  if (details.official) return 'official'
  const gather = settings.rates?.gather
  if (typeof gather === 'number') {
    if (gather === 1) return 'vanilla'
    if (gather === 2) return '2x'
    if (gather === 5) return '5x'
    if (gather === 10) return '10x'
    return `${gather}x`
  }
  return details.rust_type || 'community'
}

function deriveWipeDay(settings) {
  const wipes = settings.wipes
  if (!wipes?.length) return null
  const days = wipes[0].days
  if (!days?.length) return null
  return DAY_NAMES[days[0]] || days[0]
}

function deriveWipeFreq(details) {
  const wipes = details.rust_wipes
  if (!wipes?.length || wipes.length < 2) return null
  const gapDays = (new Date(wipes[1].timestamp).getTime() - new Date(wipes[0].timestamp).getTime()) / 86400000
  if (gapDays <= 8) return 'weekly'
  if (gapDays <= 16) return 'biweekly'
  return 'monthly'
}

function deriveGroupLimit(settings) {
  const limit = settings.groupLimit
  if (!limit || limit >= 999) return 'any'
  if (limit === 1) return 'solo'
  if (limit === 2) return 'duo'
  if (limit === 3) return 'trio'
  if (limit === 4) return 'quad'
  return String(limit)
}

function mapServer(raw) {
  const attr = raw.attributes || {}
  const details = attr.details || {}
  const settings = details.rust_settings || {}
  const parsed = parseTitle(attr.name)

  // group_limit: only trust BM's numeric limit when it's a real cap (< 999)
  const hasGroupLimit = typeof settings.groupLimit === 'number' && settings.groupLimit < 999
  const bmGroupLimit = hasGroupLimit ? deriveGroupLimit(settings) : null

  return {
    id: raw.id,
    steam_id: details.serverSteamId || null,
    name: attr.name || null,
    region: attr.country || null,
    type: deriveTypeStrict(details, settings) ?? parsed.type ?? deriveType(details, settings),
    wipe_day: deriveWipeDay(settings) ?? parsed.wipe_day,
    wipe_freq: deriveWipeFreq(details) ?? parsed.wipe_freq,
    group_limit: bmGroupLimit ?? parsed.group_limit ?? deriveGroupLimit(settings),
    current_players: attr.players ?? null,
    max_players: attr.maxPlayers ?? null,
    last_wipe: details.rust_last_wipe || null,
    next_wipe: details.rust_next_wipe || null,
    ip: attr.ip || null,
    queue: details.rust_queued_players ?? 0,
    map_seed: details.rust_world_seed ?? null,
    map_size: details.rust_world_size ?? null,
    map_url: details.rust_maps?.url || null,
    map_thumbnail: details.rust_maps?.thumbnailUrl || null,
    description: details.rust_description || null,
    url: details.rust_url || null,
    raw: JSON.stringify(raw),
  }
}

export function createBmClient({
  fetch: fetchFn = globalThis.fetch,
  baseUrl = 'https://api.battlemetrics.com',
  token = null,
} = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  return {
    async listRustServers(filters = {}, { maxPages = 3 } = {}) {
      const results = []
      for (let page = 0; page < maxPages; page++) {
        const url = new URL(`${baseUrl}/servers`)
        url.searchParams.set('filter[game]', 'rust')
        url.searchParams.set('filter[status]', 'online')
        url.searchParams.set('page[size]', '100')
        url.searchParams.set('page[offset]', String(page * 100))
        url.searchParams.set('fields[server]', 'name,players,maxPlayers,rank,status,country,details')
        if (filters.country) url.searchParams.set('filter[countries][]', filters.country)
        if (filters.search) url.searchParams.set('filter[search]', filters.search)

        const res = await fetchFn(url.toString(), { headers })
        if (!res.ok) {
          if (page === 0) throw new Error(`BattleMetrics ${res.status}`)
          console.warn(`[bm] page ${page} returned ${res.status} — returning ${results.length} partial results`)
          break
        }
        const json = await res.json()
        const batch = (json.data || []).map(mapServer)
        results.push(...batch)
        if (batch.length < 100) break
      }
      return results
    },

    // Cursor-aware single-page fetch for the collector.
    // Pass cursorUrl=null for the first page; pass the returned nextUrl for each
    // subsequent page. BM uses page[key] cursors — numeric page[offset] returns 400.
    async fetchPageCursor(cursorUrl = null, filters = {}) {
      const url = cursorUrl
        ? new URL(cursorUrl)
        : (() => {
            const u = new URL(`${baseUrl}/servers`)
            u.searchParams.set('filter[game]', 'rust')
            u.searchParams.set('filter[status]', 'online')
            u.searchParams.set('page[size]', '100')
            u.searchParams.set('fields[server]', 'name,players,maxPlayers,rank,status,country,ip,port,details')
            if (filters.country) u.searchParams.set('filter[countries][]', filters.country)
            return u
          })()
      const res = await fetchFn(url.toString(), { headers })
      if (!res.ok) throw new Error(`BattleMetrics ${res.status}`)
      const json = await res.json()
      return {
        servers: (json.data || []).map(mapServer),
        nextUrl: json.links?.next ?? null,
      }
    },

    // Legacy offset-based fetch — kept for tests; do not use in the collector.
    async fetchPage(page, filters = {}) {
      const url = new URL(`${baseUrl}/servers`)
      url.searchParams.set('filter[game]', 'rust')
      url.searchParams.set('filter[status]', 'online')
      url.searchParams.set('page[size]', '100')
      url.searchParams.set('page[offset]', String(page * 100))
      url.searchParams.set('fields[server]', 'name,players,maxPlayers,rank,status,country,ip,port,details')
      if (filters.country) url.searchParams.set('filter[countries][]', filters.country)
      const res = await fetchFn(url.toString(), { headers })
      if (!res.ok) throw new Error(`BattleMetrics ${res.status}`)
      const json = await res.json()
      return (json.data || []).map(mapServer)
    },

    async getServerHistory(serverId, { start, stop }) {
      const url = new URL(`${baseUrl}/servers/${serverId}/player-count-history`)
      url.searchParams.set('start', start)
      url.searchParams.set('stop', stop)

      const res = await fetchFn(url.toString(), { headers })
      if (!res.ok) throw new Error(`BattleMetrics ${res.status}`)
      const json = await res.json()
      return (json.data || []).map(point => ({
        recorded_at: point.attributes.timestamp,
        players: point.attributes.value,
      }))
    },
  }
}
