import { describe, it, expect, vi } from 'vitest'
import { createBmClient, parseTitle } from '../server/battlemetrics.js'

function fakeFetch(payload) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }))
}

const BASE = 'https://api.battlemetrics.com'

describe('parseTitle', () => {
  it('extracts vanilla type', () => {
    expect(parseTitle('[US] Rust | Vanilla | Fridays | Max 8').type).toBe('vanilla')
  })
  it('extracts multiplier type', () => {
    expect(parseTitle('Rust 2x Weekly Duo [EU]').type).toBe('2x')
    expect(parseTitle('Lone.Design 10x Solo/Duo [Monthly]').type).toBe('10x')
  })
  it('extracts wipe day including plural forms', () => {
    expect(parseTitle('[US] Rust | Vanilla | Fridays | Max 8').wipe_day).toBe('Friday')
    expect(parseTitle('Rust | Thursday Wipe | 2x').wipe_day).toBe('Thursday')
  })
  it('extracts wipe frequency', () => {
    expect(parseTitle('Rust 2x Weekly Duo').wipe_freq).toBe('weekly')
    expect(parseTitle('Lone.Design 10x [Monthly]').wipe_freq).toBe('monthly')
    expect(parseTitle('Rust Bi-Weekly Vanilla').wipe_freq).toBe('biweekly')
  })
  it('extracts group limit from solo/duo/trio keywords', () => {
    expect(parseTitle('Rust 2x Weekly Duo [EU]').group_limit).toBe('duo')
    expect(parseTitle('Lone.Design 10x Solo/Duo [Monthly]').group_limit).toBe('duo')
    expect(parseTitle('Rust Solo/Duo/Trio | Vanilla').group_limit).toBe('trio')
    expect(parseTitle('Rust Solo Only Vanilla').group_limit).toBe('solo')
  })
  it('extracts group limit from max N pattern', () => {
    expect(parseTitle('[US] Rust | Vanilla | Fridays | Max 8').group_limit).toBe('8')
    expect(parseTitle('Rust | Max 3 | Weekly').group_limit).toBe('trio')
  })
  it('returns nulls for unrecognised names', () => {
    const r = parseTitle('Facepunch US Long 1')
    expect(r.type).toBeNull()
    expect(r.wipe_day).toBeNull()
    expect(r.wipe_freq).toBeNull()
    expect(r.group_limit).toBeNull()
  })
})

describe('createBmClient', () => {
  describe('listRustServers', () => {
    it('maps BM JSON to flat server objects', async () => {
      const fetch = fakeFetch({
        data: [{
          id: 'bm-9',
          attributes: {
            name: 'Trio Land',
            players: 120,
            maxPlayers: 200,
            country: 'US',
            details: {
              rust_type: '2x',
              rust_last_wipe: '2026-06-01T00:00:00Z',
            },
          },
        }],
      })
      const bm = createBmClient({ fetch, baseUrl: BASE })
      const servers = await bm.listRustServers()
      expect(servers).toHaveLength(1)
      expect(servers[0]).toMatchObject({
        id: 'bm-9',
        name: 'Trio Land',
        current_players: 120,
        max_players: 200,
        region: 'US',
        type: '2x',
      })
    })

    it('throws on non-ok response', async () => {
      const fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
      const bm = createBmClient({ fetch, baseUrl: BASE })
      await expect(bm.listRustServers()).rejects.toThrow('BattleMetrics 429')
    })

    it('paginates until a partial page is returned', async () => {
      const full = { data: Array(100).fill(null).map((_, i) => ({
        id: String(i), attributes: { name: 'S', players: 1, maxPlayers: 200, country: 'US', details: {} }
      })) }
      const partial = { data: [{ id: '100', attributes: { name: 'S2', players: 1, maxPlayers: 200, country: 'US', details: {} } }] }
      const fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => full })
        .mockResolvedValueOnce({ ok: true, json: async () => partial })
      const bm = createBmClient({ fetch, baseUrl: BASE })
      const servers = await bm.listRustServers()
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(servers).toHaveLength(101)
    })

    it('stops at maxPages even when pages are full', async () => {
      const full = { data: Array(100).fill(null).map((_, i) => ({
        id: String(i), attributes: { name: 'S', players: 1, maxPlayers: 200, country: 'US', details: {} }
      })) }
      const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => full })
      const bm = createBmClient({ fetch, baseUrl: BASE })
      await bm.listRustServers({}, { maxPages: 2 })
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('getServerHistory', () => {
    it('maps history data to recorded_at/players pairs', async () => {
      const fetch = fakeFetch({
        data: [
          { attributes: { timestamp: '2026-06-01T01:00:00Z', value: 300 } },
          { attributes: { timestamp: '2026-06-02T01:00:00Z', value: 150 } },
        ],
      })
      const bm = createBmClient({ fetch, baseUrl: BASE })
      const history = await bm.getServerHistory('bm-9', {
        start: '2026-06-01T00:00:00Z',
        stop: '2026-06-08T00:00:00Z',
      })
      expect(history).toHaveLength(2)
      expect(history[0]).toEqual({ recorded_at: '2026-06-01T01:00:00Z', players: 300 })
    })
  })
})
