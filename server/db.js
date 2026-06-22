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
  try { db.exec('ALTER TABLE servers ADD COLUMN description TEXT') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN url TEXT') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN map_url TEXT') } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN map_thumbnail TEXT') } catch {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_steam_id ON servers(steam_id) WHERE steam_id IS NOT NULL') } catch {}
  // Deduplicate snapshots then enforce uniqueness so concurrent writers don't double-store an hour
  try {
    db.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT MIN(id) FROM snapshots GROUP BY server_id, recorded_at)')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_server_time ON snapshots(server_id, recorded_at)')
  } catch {}

  return {
    upsertServer({ id, steam_id, name, region, type, wipe_day, wipe_freq, group_limit,
                   current_players, max_players, last_wipe, next_wipe,
                   ip, queue, map_seed, map_size, map_url, map_thumbnail, description, url, raw }) {
      if (!name) return null  // name is NOT NULL in schema; skip rather than throw
      // If another BM entry already owns this steam_id, don't claim it here —
      // avoids UNIQUE constraint failures when BM returns duplicate steam_ids.
      if (steam_id) {
        const clash = db.prepare('SELECT id FROM servers WHERE steam_id = ? AND id != ?').get(steam_id, id)
        if (clash) steam_id = null
      }
      db.prepare(`
        INSERT INTO servers (id, steam_id, name, region, type, wipe_day, wipe_freq, group_limit,
          current_players, max_players, last_wipe, next_wipe, ip, queue,
          map_seed, map_size, map_url, map_thumbnail, description, url, raw, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          map_url       = COALESCE(excluded.map_url, map_url),
          map_thumbnail = COALESCE(excluded.map_thumbnail, map_thumbnail),
          description   = COALESCE(excluded.description, description),
          url           = COALESCE(excluded.url, url),
          raw           = excluded.raw,
          updated_at    = excluded.updated_at
      `).run(id, steam_id ?? null, name ?? null, region ?? null, type ?? null,
             wipe_day ?? null, wipe_freq ?? null, group_limit ?? null,
             current_players ?? null, max_players ?? null,
             last_wipe ?? null, next_wipe ?? null,
             ip ?? null, queue ?? 0,
             map_seed ?? null, map_size ?? null, map_url ?? null, map_thumbnail ?? null,
             description ?? null, url ?? null, raw, new Date().toISOString())
      return this.getServer(id)
    },

    // Enrich an existing BM server with Steam data, or insert a Steam-only server.
    // For BM matches: fills in ip/port/map/queue always, and type/group_limit/
    // wipe fields only when BM has nulls or generic fallback values.
    upsertSteamServer({ steam_id, name, ip, game_port, current_players, max_players,
                        map_name, last_wipe, type, group_limit, wipe_day, wipe_freq, queue }) {
      if (!steam_id) return false
      const existing = db.prepare('SELECT id FROM servers WHERE steam_id = ?').get(steam_id)
      if (existing) {
        db.prepare(`
          UPDATE servers
          SET ip            = COALESCE(ip, ?),
              game_port     = ?,
              map_name      = ?,
              queue         = ?,
              current_players = ?,
              type          = CASE WHEN (type IS NULL OR type = 'community') THEN COALESCE(?, type) ELSE type END,
              group_limit   = CASE WHEN (group_limit IS NULL OR group_limit = 'any') THEN COALESCE(?, group_limit) ELSE group_limit END,
              last_wipe     = COALESCE(last_wipe, ?),
              wipe_day      = COALESCE(wipe_day, ?),
              wipe_freq     = COALESCE(wipe_freq, ?),
              updated_at    = ?
          WHERE steam_id = ?
        `).run(ip ?? null, game_port ?? null, map_name ?? null,
               queue ?? 0, current_players ?? null,
               type ?? null, group_limit ?? null,
               last_wipe ?? null, wipe_day ?? null, wipe_freq ?? null,
               new Date().toISOString(), steam_id)
        return true
      }
      // Steam-only: not yet indexed by BM
      const id = 'steam_' + steam_id
      db.prepare(`
        INSERT INTO servers
          (id, steam_id, name, type, group_limit, wipe_day, wipe_freq,
           current_players, max_players, last_wipe, ip, game_port, map_name, queue, raw, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name            = excluded.name,
          type            = COALESCE(type, excluded.type),
          group_limit     = COALESCE(group_limit, excluded.group_limit),
          wipe_day        = COALESCE(wipe_day, excluded.wipe_day),
          wipe_freq       = COALESCE(wipe_freq, excluded.wipe_freq),
          current_players = excluded.current_players,
          last_wipe       = COALESCE(last_wipe, excluded.last_wipe),
          ip              = excluded.ip,
          game_port       = excluded.game_port,
          map_name        = excluded.map_name,
          queue           = excluded.queue,
          updated_at      = excluded.updated_at
      `).run(id, steam_id, name ?? null, type ?? null, group_limit ?? null,
             wipe_day ?? null, wipe_freq ?? null,
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

    _buildWhere({ region, type, wipe_day, wipe_freq, group_limit, search } = {}) {
      const conditions = []
      const params = []
      if (region)      { conditions.push('region = ?');      params.push(region) }
      if (type)        { conditions.push('type = ?');        params.push(type) }
      if (wipe_day)    { conditions.push('wipe_day = ?');    params.push(wipe_day) }
      if (wipe_freq)   { conditions.push('wipe_freq = ?');   params.push(wipe_freq) }
      if (group_limit) {
        if (group_limit === 'any') {
          conditions.push("(group_limit = 'any' OR (group_limit GLOB '[0-9]*' AND CAST(group_limit AS INTEGER) > 4))")
        } else {
          conditions.push('group_limit = ?')
          params.push(group_limit)
        }
      }
      if (search)      { conditions.push('name LIKE ?');     params.push(`%${search}%`) }
      return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
    },

    countServers(filters = {}) {
      const { where, params } = this._buildWhere(filters)
      return db.prepare(`SELECT COUNT(*) as n FROM servers ${where}`).get(...params).n
    },

    listServers({ region, type, wipe_day, wipe_freq, group_limit, search, sort, page = 1, limit = 25 } = {}) {
      const { where, params } = this._buildWhere({ region, type, wipe_day, wipe_freq, group_limit, search })
      const order = sort === 'retention'
        ? 'ORDER BY retention DESC NULLS LAST'
        : sort === 'health'
        ? 'ORDER BY CASE WHEN retention >= 0.7 THEN 3 WHEN retention >= 0.4 THEN 2 WHEN retention IS NOT NULL THEN 1 ELSE 0 END DESC, current_players DESC'
        : 'ORDER BY current_players DESC'
      const offset = (page - 1) * limit
      return db.prepare(`SELECT * FROM servers ${where} ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset)
    },

    // Returns BM-indexed servers eligible for history backfill, ordered by
    // most active first so popular servers get curves in the first run.
    listServersForBackfill({ floor = 5, cap = 500 } = {}) {
      return db.prepare(`
        SELECT id, last_wipe FROM servers
        WHERE id NOT LIKE 'steam_%'
          AND last_wipe IS NOT NULL
          AND (current_players IS NULL OR current_players >= ?)
        ORDER BY current_players DESC NULLS LAST
        LIMIT ?
      `).all(floor, cap)
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
