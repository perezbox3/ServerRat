import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS servers (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    region          TEXT,
    type            TEXT,
    wipe_day        TEXT,
    wipe_freq       TEXT,
    group_limit     TEXT,
    current_players INTEGER,
    max_players     INTEGER,
    last_wipe       TEXT,
    next_wipe       TEXT,
    raw             TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   TEXT NOT NULL REFERENCES servers(id),
    recorded_at TEXT NOT NULL,
    players     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cache_meta (
    key        TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL
  );
`

export function createDb(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  return {
    upsertServer({ id, name, region, type, wipe_day, wipe_freq, group_limit, current_players, max_players, last_wipe, next_wipe, raw }) {
      db.prepare(`
        INSERT INTO servers (id, name, region, type, wipe_day, wipe_freq, group_limit, current_players, max_players, last_wipe, next_wipe, raw, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          region = excluded.region,
          type = excluded.type,
          wipe_day = excluded.wipe_day,
          wipe_freq = excluded.wipe_freq,
          group_limit = excluded.group_limit,
          current_players = excluded.current_players,
          max_players = excluded.max_players,
          last_wipe = excluded.last_wipe,
          next_wipe = excluded.next_wipe,
          raw = excluded.raw,
          updated_at = excluded.updated_at
      `).run(id, name ?? null, region ?? null, type ?? null, wipe_day ?? null, wipe_freq ?? null,
             group_limit ?? null, current_players ?? null, max_players ?? null,
             last_wipe ?? null, next_wipe ?? null, raw,
             new Date().toISOString())
      return this.getServer(id)
    },

    getServer(id) {
      return db.prepare('SELECT * FROM servers WHERE id = ?').get(id)
    },

    listServers({ region, type, wipe_day, wipe_freq, group_limit } = {}) {
      const conditions = []
      const params = []
      if (region)      { conditions.push('region = ?');      params.push(region) }
      if (type)        { conditions.push('type = ?');        params.push(type) }
      if (wipe_day)    { conditions.push('wipe_day = ?');    params.push(wipe_day) }
      if (wipe_freq)   { conditions.push('wipe_freq = ?');   params.push(wipe_freq) }
      if (group_limit) { conditions.push('group_limit = ?'); params.push(group_limit) }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      return db.prepare(`SELECT * FROM servers ${where} ORDER BY current_players DESC`).all(...params)
    },

    addSnapshot({ server_id, recorded_at, players }) {
      db.prepare(`
        INSERT OR IGNORE INTO snapshots (server_id, recorded_at, players)
        VALUES (?, ?, ?)
      `).run(server_id, recorded_at, players)
    },

    getSnapshots(server_id) {
      return db.prepare(`
        SELECT * FROM snapshots WHERE server_id = ? ORDER BY recorded_at ASC
      `).all(server_id)
    },

    touchCache(key) {
      db.prepare(`
        INSERT INTO cache_meta (key, fetched_at) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at
      `).run(key, new Date().toISOString())
    },

    isStale(key, ttlSeconds) {
      const row = db.prepare('SELECT fetched_at FROM cache_meta WHERE key = ?').get(key)
      if (!row) return true
      const age = (Date.now() - new Date(row.fetched_at).getTime()) / 1000
      return age > ttlSeconds
    },
  }
}
