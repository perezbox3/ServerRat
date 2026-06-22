import { parseTitle } from './parse.js'

const RUST_APP_ID = 252490

function decodeGametype(gametype = '') {
  const parts = gametype.split(',')
  const get = prefix => {
    const p = parts.find(x => x.startsWith(prefix))
    return p ? p.slice(prefix.length) : null
  }
  const born = get('born')
  const gm = get('gm')
  const ts = get('ts')
  const qp = get('qp')
  return {
    last_wipe: born ? new Date(parseInt(born, 10) * 1000).toISOString() : null,
    game_mode: gm ?? null,
    team_size: ts !== null ? parseInt(ts, 10) : null,
    queue: qp !== null ? parseInt(qp, 10) : 0,
  }
}

function deriveType(game_mode) {
  if (game_mode === 'vanilla') return 'vanilla'
  return null  // 2x/5x/etc. needs BM's gather-rate data
}

function deriveGroupLimit(team_size) {
  if (team_size === null || team_size === 0 || team_size >= 8) return 'any'
  if (team_size === 1) return 'solo'
  if (team_size === 2) return 'duo'
  if (team_size === 3) return 'trio'
  if (team_size === 4) return 'quad'
  return String(team_size)
}

export function mapSteamServer(raw) {
  const { last_wipe, game_mode, team_size, queue } = decodeGametype(raw.gametype)
  const ip = raw.addr ? raw.addr.split(':')[0] : null
  const parsed = parseTitle(raw.name)

  // Steam's gametype is authoritative for vanilla (gm field); for multiplier rates
  // we rely on BM's gather data, but title parsing covers the gap.
  const type = deriveType(game_mode) ?? parsed.type

  // Steam's ts field is authoritative when it's a real limit (> 0).
  // When ts=0 (no enforced limit), fall back to title parsing.
  const steamGroup = deriveGroupLimit(team_size)
  const group_limit = steamGroup !== 'any' ? steamGroup : (parsed.group_limit ?? 'any')

  return {
    steam_id: raw.steamid ?? null,
    name: raw.name ?? null,
    ip,
    game_port: raw.gameport ?? null,
    current_players: raw.players ?? null,
    max_players: raw.max_players ?? null,
    map_name: raw.map ?? null,
    last_wipe,
    type,
    group_limit,
    wipe_day: parsed.wipe_day,
    wipe_freq: parsed.wipe_freq,
    queue,
  }
}

export function createSteamClient({
  fetch: fetchFn = globalThis.fetch,
  apiKey,
} = {}) {
  if (!apiKey) throw new Error('STEAM_API_KEY is required')

  return {
    async listRustServers() {
      const url = new URL('https://api.steampowered.com/IGameServersService/GetServerList/v1/')
      url.searchParams.set('key', apiKey)
      url.searchParams.set('filter', `\\appid\\${RUST_APP_ID}`)
      url.searchParams.set('limit', '30000')

      const res = await fetchFn(url.toString())
      if (!res.ok) throw new Error(`Steam ${res.status}`)
      const json = await res.json()
      return (json.response?.servers ?? []).map(mapSteamServer)
    },
  }
}
