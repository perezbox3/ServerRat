// A2S enrichment — queries Rust game servers directly via UDP.
// Uses A2S_RULES to get seed, size, description, and wipe metadata.
// Never throws: returns null per server on timeout or network failure.

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { GameDig } = require('gamedig')

const QUERY_TIMEOUT = 2000  // 2s — online Rust servers respond in < 200ms
const DEFAULT_CONCURRENCY = 25

async function queryRules(ip, queryPort) {
  try {
    const state = await GameDig.query({
      type: 'rust',
      host: ip,
      port: queryPort,
      socketTimeout: QUERY_TIMEOUT,
      requestRules: true,
    })
    const rules = state.raw?.rules ?? {}
    const tagsStr = rules['server.tags'] ?? ''
    const tags = tagsStr.split(',')

    const wipeUnix = rules['LastWipeUTC'] ? parseInt(rules['LastWipeUTC'], 10) : null
    const last_wipe = wipeUnix ? new Date(wipeUnix * 1000).toISOString() : null
    const wipe_day = wipeUnix
      ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
          new Date(wipeUnix * 1000).getUTCDay()
        ]
      : null

    const wipe_freq = tags.includes('monthly') ? 'monthly'
                    : tags.includes('biweekly') ? 'biweekly'
                    : tags.includes('weekly') ? 'weekly'
                    : null

    const rateTag = tags.find(t => /^\d+x$/i.test(t))
    const type = tags.includes('vanilla') ? 'vanilla' : (rateTag ?? null)

    return {
      map_seed: rules['world.seed'] != null ? parseInt(rules['world.seed'], 10) : null,
      map_size: rules['world.size'] != null ? parseInt(rules['world.size'], 10) : null,
      description: rules['server.description'] || null,
      last_wipe,
      wipe_day,
      wipe_freq,
      type,
    }
  } catch {
    return null
  }
}

export function createA2sClient({ concurrency = DEFAULT_CONCURRENCY } = {}) {
  return {
    async enrichBatch(servers, { onProgress } = {}) {
      const results = new Map()
      let done = 0
      for (let i = 0; i < servers.length; i += concurrency) {
        const chunk = servers.slice(i, i + concurrency)
        const chunkResults = await Promise.all(
          chunk.map(async ({ id, ip, query_port }) => ({ id, data: await queryRules(ip, query_port) }))
        )
        for (const { id, data } of chunkResults) results.set(id, data)
        done += chunk.length
        onProgress?.(done, servers.length)
      }
      return results
    },
  }
}
