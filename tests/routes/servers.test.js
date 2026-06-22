import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { createDb } from '../../server/db.js'

function makeDb() { return createDb(':memory:') }

function makeBm(overrides = {}) {
  return {
    listRustServers: vi.fn(async () => []),
    getServerHistory: vi.fn(async () => []),
    ...overrides,
  }
}

const WIPE = '2026-06-15T00:00:00Z'
function wipeOffset(days) {
  return new Date(new Date(WIPE).getTime() + days * 86400000).toISOString()
}

const srv1 = {
  id: 'srv-1', name: 'Duo Land', region: 'US', type: '2x',
  wipe_day: 'Thursday', wipe_freq: 'biweekly', group_limit: 'duo',
  current_players: 120, max_players: 200,
  last_wipe: WIPE, next_wipe: null, raw: '{}',
}
const srv2 = {
  id: 'srv-2', name: 'Vanilla Land', region: 'US', type: 'vanilla',
  wipe_day: 'Monday', wipe_freq: 'monthly', group_limit: 'any',
  current_players: 80, max_players: 150,
  last_wipe: '2026-06-10T00:00:00Z', next_wipe: null, raw: '{}',
}

describe('GET /api/servers', () => {
  it('returns paginated envelope with servers, total, page, limit', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)

    const res = await request(createApp({ db, bm })).get('/api/servers')

    expect(res.status).toBe(200)
    expect(res.body.servers).toHaveLength(2)
    expect(res.body.total).toBe(2)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(25)
    expect(bm.listRustServers).not.toHaveBeenCalled()
  })

  it('returns filtered servers from DB', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)

    const res = await request(createApp({ db, bm })).get('/api/servers?type=2x')

    expect(res.status).toBe(200)
    expect(res.body.servers).toHaveLength(1)
    expect(res.body.servers[0].id).toBe('srv-1')
    expect(res.body.total).toBe(1)
  })

  it('paginates — page 2 returns second batch', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)

    const res = await request(createApp({ db, bm })).get('/api/servers?limit=1&page=2')

    expect(res.status).toBe(200)
    expect(res.body.servers).toHaveLength(1)
    expect(res.body.total).toBe(2)
    expect(res.body.page).toBe(2)
  })

  it('returns all servers when no filter applied', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)

    const res = await request(createApp({ db, bm })).get('/api/servers')

    expect(res.status).toBe(200)
    expect(res.body.servers).toHaveLength(2)
    expect(bm.listRustServers).not.toHaveBeenCalled()
  })

  it('filters by server name substring when search param is provided', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1) // 'Duo Land'
    db.upsertServer(srv2) // 'Vanilla Land'

    const res = await request(createApp({ db, bm })).get('/api/servers?search=vanilla')

    expect(res.status).toBe(200)
    expect(res.body.servers).toHaveLength(1)
    expect(res.body.servers[0].id).toBe('srv-2')
    expect(bm.listRustServers).not.toHaveBeenCalled()
  })

  it('drops invalid type param — treats it as no filter', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)

    const res = await request(createApp({ db, bm })).get('/api/servers?type=DROP+TABLE')

    expect(res.status).toBe(200)
    expect(bm.listRustServers).not.toHaveBeenCalled()
    expect(res.body.servers).toHaveLength(2)
  })
})

describe('GET /api/servers/:id', () => {
  it('returns server + curve array + health band', async () => {
    const db = makeDb()
    const bm = makeBm({
      getServerHistory: vi.fn(async () => [
        { recorded_at: wipeOffset(0.5), players: 300 },
        { recorded_at: wipeOffset(2.5), players: 270 },
      ]),
    })
    db.upsertServer(srv1)

    const res = await request(createApp({ db, bm })).get('/api/servers/srv-1')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('srv-1')
    expect(res.body.curve).not.toBeNull()
    expect(res.body.curve.values).toHaveLength(5)
    expect(res.body.curve.values[0]).toBe(300)  // day1
    expect(res.body.curve.values[2]).toBe(270)  // day3
    expect(res.body.curve.health).toBe('healthy')
    expect(res.body.curve.retention).toBeCloseTo(0.9)
  })

  it('returns curve: null when server has no last_wipe', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer({ ...srv1, id: 'srv-3', last_wipe: null })

    const res = await request(createApp({ db, bm })).get('/api/servers/srv-3')

    expect(res.status).toBe(200)
    expect(res.body.curve).toBeNull()
  })

  it('returns 404 for unknown id', async () => {
    const res = await request(createApp({ db: makeDb(), bm: makeBm() }))
      .get('/api/servers/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('returns server with null curve when BM history call fails', async () => {
    const db = makeDb()
    const bm = makeBm({ getServerHistory: vi.fn(async () => { throw new Error('timeout') }) })
    db.upsertServer(srv1)

    const res = await request(createApp({ db, bm })).get('/api/servers/srv-1')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('srv-1')
    expect(res.body.curve).not.toBeUndefined()
  })

  it('returns pop30 array of 30 entries', async () => {
    const db = makeDb()
    const bm = makeBm({
      getServerHistory: vi.fn(async () => [
        { recorded_at: wipeOffset(0.5), players: 300 },
      ]),
    })
    db.upsertServer(srv1)

    const res = await request(createApp({ db, bm })).get('/api/servers/srv-1')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.pop30)).toBe(true)
    expect(res.body.pop30).toHaveLength(30)
  })

  it('returns wipe_history array', async () => {
    const db = makeDb()
    const bm = makeBm({
      getServerHistory: vi.fn(async () => [
        { recorded_at: wipeOffset(0.5), players: 300 },
        { recorded_at: wipeOffset(2.5), players: 200 },
      ]),
    })
    db.upsertServer(srv1)

    const res = await request(createApp({ db, bm })).get('/api/servers/srv-1')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.wipe_history)).toBe(true)
  })

  it('stores retention in DB after computing curve', async () => {
    const db = makeDb()
    const bm = makeBm({
      getServerHistory: vi.fn(async () => [
        { recorded_at: wipeOffset(0.5), players: 300 },
        { recorded_at: wipeOffset(2.5), players: 270 },
      ]),
    })
    db.upsertServer(srv1)

    await request(createApp({ db, bm })).get('/api/servers/srv-1')

    expect(db.getServer('srv-1').retention).toBeCloseTo(0.9)
  })
})

describe('POST /api/match', () => {
  it('ranks servers — real retention above null-retention', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)
    db.addSnapshot({ server_id: 'srv-1', recorded_at: wipeOffset(0.5), players: 300 })
    db.addSnapshot({ server_id: 'srv-1', recorded_at: wipeOffset(2.5), players: 270 })

    const res = await request(createApp({ db, bm })).post('/api/match').send({})

    expect(res.status).toBe(200)
    expect(res.body[0].id).toBe('srv-1')
    expect(res.body[1].id).toBe('srv-2')
  })

  it('filters by criteria before ranking', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)

    const res = await request(createApp({ db, bm }))
      .post('/api/match')
      .send({ type: '2x' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('srv-1')
  })
})
