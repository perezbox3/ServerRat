import { describe, it, expect, vi } from 'vitest'
import { createBmClient } from '../server/battlemetrics.js'

function fakeFetch(payload) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }))
}

const BASE = 'https://api.battlemetrics.com'

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
