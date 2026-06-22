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
  // Migrations — safe to run on every startup
  try { db.exec('ALTER TABLE servers ADD COLUMN retention REAL') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN steam_id TEXT') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN ip TEXT') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN game_port INTEGER') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN map_name TEXT') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN map_seed INTEGER') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN map_size INTEGER') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN queue INTEGER DEFAULT 0') } catch {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_steam_id ON servers(steam_id) WHERE steam_id IS NOT NULL') } catch {}

  return {
    upsertServer({ id, steam_id, name, region, type, wipe_day, wipe_freq, group_limit,
                   current_players, max_players, last_wipe, next_wipe,
                   ip, queue, map_seed, map_size, raw }) {
      db.prepare(`
        INSERT INTO servers (id, steam_id, name, region, type, wipe_day, wipe_freq, group_limit,
          current_players, max_players, last_wipe, next_wipe, ip, queue, map_seed, map_size, raw, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          steam_id      = COALESCE(excluded.steam_id, steam_id),
          name          = excluded.name,
          region        = excluded.region,
          type          = excluded.type,
          wipe_day      = excluded.wipe_day,
          wipe_freq     = excluded.wipe_freq,
          group_limit   = excluded.group_limit,
          current_players = excluded.current_players,
          max_players   = excluded.max_players,
          last_wipe     = excluded.last_wipe,
          next_wipe     = excluded.next_wipe,
          ip            = COALESCE(excluded.ip, ip),
          queue         = excluded.queue,
          map_seed      = COALESCE(excluded.map_seed, map_seed),
          map_size      = COALESCE(excluded.map_size, map_size),
          raw           = excluded.raw,
          updated_at    = excluded.updated_at
      `).run(id, steam_id ?? null, name ?? null, region ?? null, type ?? null,
             wipe_day ?? null, wipe_freq ?? null, group_limit ?? null,
             current_players ?? null, max_players ?? null,
             last_wipe ?? null, next_wipe ?? null,
             ip ?? null, queue ?? 0, map_seed ?? null, map_size ?? null,
             raw, new Date().toISOString())
      return this.getServer(id)
    },

    // Enrich an existing BM server with Steam's game_port/map_name/queue,
    // or insert a Steam-only server with a synthetic 'steam_{id}' primary key.
    upsertSteamServer({ steam_id, name, ip, game_port, current_players, max_players,
                        map_name, last_wipe, type, group_limit, queue }) {
      if (!steam_id) return false
      const existing = db.prepare('SELECT id FROM servers WHERE steam_id = ?').get(steam_id)
      if (existing) {
        db.prepare(`
          UPDATE servers
          SET ip = COALESCE(ip, ?), game_port = ?, map_name = ?,
              queue = ?, current_players = ?, updated_at = ?
          WHERE steam_id = ?
        `).run(ip ?? null, game_port ?? null, map_name ?? null,
               queue ?? 0, current_players ?? null,
               new Date().toISOString(), steam_id)
        return true
      }
      // Steam-only: not yet indexed by BM
      const id = 'steam_' + steam_id
      db.prepare(`
        INSERT INTO servers
          (id, steam_id, name, type, group_limit, current_players, max_players,
           last_wipe, ip, game_port, map_name, queue, raw, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name            = excluded.name,
          type            = COALESCE(type, excluded.type),
          group_limit     = COALESCE(group_limit, excluded.group_limit),
          current_players = excluded.current_players,
          last_wipe       = COALESCE(last_wipe, excluded.last_wipe),
          ip              = excluded.ip,
          game_port       = excluded.game_port,
          map_name        = excluded.map_name,
          queue           = excluded.queue,
          updated_at      = excluded.updated_at
      `).run(id, steam_id, name ?? null, type ?? null, group_limit ?? null,
             current_players ?? null, max_players ?? null, last_wipe ?? null,
             ip ?? null, game_port ?? null, map_name ?? null, queue ?? 0,
             '{}', new Date().toISOString())
      return true
    },

    updateRetention(id, retention) {
      db.prepare('UPDATE servers SET retention = ? WHERE id = ?').run(retention ?? null, id)
    },

    getServer(id) {
      return db.prepare('SELECT * FROM servers WHERE id = ?').get(id)
    },

    listServers({ region, type, wipe_day, wipe_freq, group_limit, search, sort } = {}) {
      const conditions = []
      const params = []
      if (region)      { conditions.push('region = ?');      params.push(region) }
      if (type)        { conditions.push('type = ?');        params.push(type) }
      if (wipe_day)    { conditions.push('wipe_day = ?');    params.push(wipe_day) }
      if (wipe_freq)   { conditions.push('wipe_freq = ?');   params.push(wipe_freq) }
      if (group_limit) { conditions.push('group_limit = ?'); params.push(group_limit) }
      if (search)      { conditions.push('name LIKE ?');     params.push(`%${search}%`) }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const order = sort === 'retention'
        ? 'ORDER BY retention DESC NULLS LAST'
        : 'ORDER BY current_players DESC'
      return db.prepare(`SELECT * FROM servers ${where} ${order}`).all(...params)
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
