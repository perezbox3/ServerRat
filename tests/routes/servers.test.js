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
  it('returns filtered servers from DB when cache is fresh', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)
    db.touchCache('servers-list')

    const res = await request(createApp({ db, bm })).get('/api/servers?type=2x')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('srv-1')
    expect(bm.listRustServers).not.toHaveBeenCalled()
  })

  it('fetches from BM and hydrates DB when cache is stale', async () => {
    const db = makeDb()
    const bm = makeBm({ listRustServers: vi.fn(async () => [srv1]) })

    const res = await request(createApp({ db, bm })).get('/api/servers')

    expect(res.status).toBe(200)
    expect(bm.listRustServers).toHaveBeenCalledOnce()
    expect(db.getServer('srv-1')).not.toBeNull()
  })

  it('serves from DB on second request without calling BM again', async () => {
    const db = makeDb()
    const bm = makeBm({ listRustServers: vi.fn(async () => [srv1]) })
    const app = createApp({ db, bm })

    await request(app).get('/api/servers')
    await request(app).get('/api/servers')

    expect(bm.listRustServers).toHaveBeenCalledOnce()
  })

  it('returns 502 when BM is unavailable', async () => {
    const db = makeDb()
    const bm = makeBm({ listRustServers: vi.fn(async () => { throw new Error('BM down') }) })

    const res = await request(createApp({ db, bm })).get('/api/servers')

    expect(res.status).toBe(502)
    expect(res.body.error).toBeDefined()
  })

  it('drops invalid type param — treats it as no filter', async () => {
    const db = makeDb()
    const bm = makeBm()
    db.upsertServer(srv1)
    db.upsertServer(srv2)
    db.touchCache('servers-list')

    const res = await request(createApp({ db, bm })).get('/api/servers?type=DROP+TABLE')

    expect(res.status).toBe(200)
    expect(bm.listRustServers).not.toHaveBeenCalled()
    // invalid type dropped → no type filter → all 2 servers returned
    expect(res.body).toHaveLength(2)
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

  it('returns 502 when BM history call fails', async () => {
    const db = makeDb()
    const bm = makeBm({ getServerHistory: vi.fn(async () => { throw new Error('timeout') }) })
    db.upsertServer(srv1)

    const res = await request(createApp({ db, bm })).get('/api/servers/srv-1')

    expect(res.status).toBe(502)
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
