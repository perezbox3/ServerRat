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
  try { db.exec('ALTER TABLE servers ADD COLUMN query_port INTEGER') } catch {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_steam_id ON servers(steam_id) WHERE steam_id IS NOT NULL') } catch {}
  // Deduplicate snapshots then enforce uniqueness so concurrent writers don't double-store an hour
  try {
    db.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT MIN(id) FROM snapshots GROUP BY server_id, recorded_at)')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_server_time ON snapshots(server_id, recorded_at)')
  } catch {}

  return {
    upsertServer({ id, steam_id, name, region, type, wipe_day, wipe_freq, group_limit,
                   current_players, max_players, last_wipe, next_wipe,
                   ip, query_port, queue, map_seed, map_size, map_url, map_thumbnail, description, url, raw }) {
      if (!name) return null  // name is NOT NULL in schema; skip rather than throw
      // If another entry already owns this steam_id, don't claim it here.
      if (steam_id) {
        const clash = db.prepare('SELECT id FROM servers WHERE steam_id = ? AND id != ?').get(steam_id, id)
        if (clash) steam_id = null
      }
      db.prepare(`
        INSERT INTO servers (id, steam_id, name, region, type, wipe_day, wipe_freq, group_limit,
          current_players, max_players, last_wipe, next_wipe, ip, query_port, queue,
          map_seed, map_size, map_url, map_thumbnail, description, url, raw, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          query_port    = COALESCE(excluded.query_port, query_port),
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
             ip ?? null, query_port ?? null, queue ?? 0,
             map_seed ?? null, map_size ?? null, map_url ?? null, map_thumbnail ?? null,
             description ?? null, url ?? null, raw, new Date().toISOString())
      return this.getServer(id)
    },

    // Enrich an existing server with Steam data, or insert a Steam-only server.
    // Returns the server's ID (string) so the caller can write a snapshot, or null on failure.
    upsertSteamServer({ steam_id, name, ip, query_port, game_port, current_players, max_players,
                        map_name, last_wipe, type, group_limit, wipe_day, wipe_freq, queue }) {
      if (!steam_id) return null
      const existing = db.prepare('SELECT id FROM servers WHERE steam_id = ?').get(steam_id)
      if (existing) {
        db.prepare(`
          UPDATE servers
          SET ip            = COALESCE(ip, ?),
              query_port    = COALESCE(query_port, ?),
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
        `).run(ip ?? null, query_port ?? null, game_port ?? null, map_name ?? null,
               queue ?? 0, current_players ?? null,
               type ?? null, group_limit ?? null,
               last_wipe ?? null, wipe_day ?? null, wipe_freq ?? null,
               new Date().toISOString(), steam_id)
        return existing.id
      }
      // Steam-only: not yet indexed elsewhere
      const id = 'steam_' + steam_id
      db.prepare(`
        INSERT INTO servers
          (id, steam_id, name, type, group_limit, wipe_day, wipe_freq,
           current_players, max_players, last_wipe, ip, query_port, game_port, map_name, queue, raw, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name            = excluded.name,
          type            = COALESCE(type, excluded.type),
          group_limit     = COALESCE(group_limit, excluded.group_limit),
          wipe_day        = COALESCE(wipe_day, excluded.wipe_day),
          wipe_freq       = COALESCE(wipe_freq, excluded.wipe_freq),
          current_players = excluded.current_players,
          last_wipe       = COALESCE(last_wipe, excluded.last_wipe),
          ip              = excluded.ip,
          query_port      = COALESCE(query_port, excluded.query_port),
          game_port       = excluded.game_port,
          map_name        = excluded.map_name,
          queue           = excluded.queue,
          updated_at      = excluded.updated_at
      `).run(id, steam_id, name ?? null, type ?? null, group_limit ?? null,
             wipe_day ?? null, wipe_freq ?? null,
             current_players ?? null, max_players ?? null, last_wipe ?? null,
             ip ?? null, query_port ?? null, game_port ?? null, map_name ?? null, queue ?? 0,
             '{}', new Date().toISOString())
      return id
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

    // Returns active servers that have an IP + query port so A2S can enrich them.
    // Ordered by current players so popular servers get data first.
    listServersForA2sEnrichment({ cap = 3000 } = {}) {
      return db.prepare(`
        SELECT id, ip, query_port FROM servers
        WHERE ip IS NOT NULL
          AND query_port IS NOT NULL
          AND current_players > 0
        ORDER BY current_players DESC
        LIMIT ?
      `).all(cap)
    },

    // Write A2S_RULES data back to a server row.
    // map_seed/map_size: always overwrite (change on wipe).
    // description/type/wipe_day/wipe_freq: fill nulls only (stable metadata).
    // last_wipe: advance to the A2S value when it's newer than what we have.
    updateA2sData(id, { map_seed, map_size, description, last_wipe, wipe_day, wipe_freq, type }) {
      db.prepare(`
        UPDATE servers
        SET map_seed    = COALESCE(?, map_seed),
            map_size    = COALESCE(?, map_size),
            description = COALESCE(?, description),
            last_wipe   = CASE
                            WHEN ? IS NULL THEN last_wipe
                            WHEN last_wipe IS NULL OR ? > last_wipe THEN ?
                            ELSE last_wipe
                          END,
            wipe_day    = COALESCE(wipe_day, ?),
            wipe_freq   = COALESCE(wipe_freq, ?),
            type        = COALESCE(type, ?),
            updated_at  = ?
        WHERE id = ?
      `).run(
        map_seed ?? null, map_size ?? null, description ?? null,
        last_wipe ?? null, last_wipe ?? null, last_wipe ?? null,
        wipe_day ?? null, wipe_freq ?? null, type ?? null,
        new Date().toISOString(), id
      )
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
