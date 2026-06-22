import { describe, it, expect } from 'vitest'
import { createSteamClient, mapSteamServer } from '../server/steam.js'

const FAKE_SERVER = {
  addr: '64.40.9.156:28017',
  gameport: 28015,
  steamid: '90286857894963224',
  name: 'Rusty Moose |US Biweekly|',
  appid: 252490,
  players: 723,
  max_players: 500,
  map: 'Procedural Map',
  gametype: 'mp500,cp723,ptrak,qp14,v2627,born1780627787,gmrust,ts3',
}

const VANILLA_SERVER = {
  ...FAKE_SERVER,
  steamid: '11111',
  gametype: 'mp200,cp80,ptrak,qp0,v2627,born1780000000,gmvanilla,ts0',
}

const SOLO_SERVER = {
  ...FAKE_SERVER,
  steamid: '22222',
  gametype: 'mp100,cp50,ptrak,qp0,v2627,born1780000000,gmrust,ts1',
}

describe('mapSteamServer', () => {
  it('maps steamid, name, ip, game_port, players', () => {
    const s = mapSteamServer(FAKE_SERVER)
    expect(s.steam_id).toBe('90286857894963224')
    expect(s.name).toBe('Rusty Moose |US Biweekly|')
    expect(s.ip).toBe('64.40.9.156')
    expect(s.game_port).toBe(28015)
    expect(s.current_players).toBe(723)
    expect(s.max_players).toBe(500)
    expect(s.map_name).toBe('Procedural Map')
  })

  it('decodes born timestamp to last_wipe ISO string', () => {
    const s = mapSteamServer(FAKE_SERVER)
    expect(s.last_wipe).toBe(new Date(1780627787 * 1000).toISOString())
  })

  it('decodes queue count from qp token', () => {
    expect(mapSteamServer(FAKE_SERVER).queue).toBe(14)
    expect(mapSteamServer(VANILLA_SERVER).queue).toBe(0)
  })

  it('maps gmvanilla to type vanilla', () => {
    expect(mapSteamServer(VANILLA_SERVER).type).toBe('vanilla')
  })

  it('maps gmrust to null type (BM has the gather-rate detail)', () => {
    expect(mapSteamServer(FAKE_SERVER).type).toBeNull()
  })

  it('maps ts3 to group_limit trio', () => {
    const s = mapSteamServer(FAKE_SERVER)
    expect(s.group_limit).toBe('trio')
  })

  it('maps ts1 to solo', () => {
    expect(mapSteamServer(SOLO_SERVER).group_limit).toBe('solo')
  })

  it('maps ts0 to any', () => {
    expect(mapSteamServer(VANILLA_SERVER).group_limit).toBe('any')
  })

  it('falls back to title parsing for group_limit when ts=0', () => {
    const s = mapSteamServer({
      ...FAKE_SERVER,
      steamid: '33333',
      name: 'Rust Duo Only | 2x | Weekly',
      gametype: 'mp200,cp80,ptrak,qp0,v2627,born1780000000,gmrust,ts0',
    })
    expect(s.group_limit).toBe('duo')
  })

  it('extracts wipe_day and wipe_freq from server name', () => {
    const s = mapSteamServer(FAKE_SERVER)  // 'Rusty Moose |US Biweekly|'
    expect(s.wipe_freq).toBe('biweekly')
    expect(s.wipe_day).toBeNull()
  })

  it('extracts wipe_day and group_limit from name when ts=0', () => {
    const s = mapSteamServer({
      ...FAKE_SERVER,
      steamid: '44444',
      name: 'Rust 2x Fridays Weekly Solo',
      gametype: 'mp200,cp50,ptrak,qp0,v2627,born1780000000,gmrust,ts0',
    })
    expect(s.wipe_day).toBe('Friday')
    expect(s.wipe_freq).toBe('weekly')
    expect(s.type).toBe('2x')
    expect(s.group_limit).toBe('solo')
  })

  it('handles missing gametype gracefully', () => {
    const s = mapSteamServer({ ...FAKE_SERVER, gametype: undefined })
    expect(s.last_wipe).toBeNull()
    expect(s.queue).toBe(0)
    expect(s.group_limit).toBe('any')
  })
})

describe('createSteamClient', () => {
  it('throws if no API key provided', () => {
    expect(() => createSteamClient()).toThrow('STEAM_API_KEY is required')
  })

  it('fetches and maps the server list', async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ response: { servers: [FAKE_SERVER, VANILLA_SERVER] } }),
    })
    const client = createSteamClient({ fetch: fakeFetch, apiKey: 'test-key' })
    const servers = await client.listRustServers()
    expect(servers).toHaveLength(2)
    expect(servers[0].steam_id).toBe('90286857894963224')
    expect(servers[1].type).toBe('vanilla')
  })

  it('throws on non-ok response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 403 })
    const client = createSteamClient({ fetch: fakeFetch, apiKey: 'bad-key' })
    await expect(client.listRustServers()).rejects.toThrow('Steam 403')
  })

  it('returns empty array when Steam returns no servers', async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ response: {} }),
    })
    const client = createSteamClient({ fetch: fakeFetch, apiKey: 'test-key' })
    const servers = await client.listRustServers()
    expect(servers).toHaveLength(0)
  })
})
