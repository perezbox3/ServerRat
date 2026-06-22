# Steam Web API — Findings

**Probe date:** 2026-06-21  
**Script:** `scripts/spike-steam.js`

## Results

| Metric | Value |
|---|---|
| Total Rust servers returned | 9,999 (Steam caps at ~10k per request) |
| Servers with players > 0 | 2,529 |
| Name contains "Vanilla" | 654 |

Steam likely indexes 15,000–20,000 Rust servers total. The 9,999 cap means we need to think about pagination or filtering (e.g. by region) to get the full list in later tasks.

## Fields Available

```json
{
  "addr": "99.7.43.153:28017",   // IP:query_port
  "gameport": 28015,              // game connection port (what players use)
  "steamid": "90286857894963224", // Steam server ID — THE JOIN KEY
  "name": "Rustbois Dallas | No Decay | Solo/Duo/Trio",
  "appid": 252490,
  "players": 2,
  "max_players": 20,
  "map": "Procedural Map",
  "gametype": "mp20,cp2,ptrak,qp0,$r?,v2627,^m,^v,NA,born1780627787,gmrust,cs153461,ts8",
  "secure": true,
  "os": "w"
}
```

## Gametype String Decoding

The `gametype` field encodes extra data as comma-separated tokens:

| Token prefix | Example | Meaning |
|---|---|---|
| `born` | `born1780627787` | Unix timestamp of **last wipe** |
| `gm` | `gmvanilla`, `gmrust`, `gmmodded` | Game mode / server type |
| `ts` | `ts2`, `ts3`, `ts8` | Max team size → group limit |
| `qp` | `qp0`, `qp14` | **Queue count** |
| `mp` | `mp200` | Max players (redundant) |
| `cp` | `cp120` | Current players (redundant) |

Derived fields:
- `born` → `last_wipe` (ISO string)
- `gmvanilla` → `type = 'vanilla'`; `gmrust`/`gmmodded` → `null` (BM has the gather-rate detail)
- `ts1/2/3/4` → `group_limit = solo/duo/trio/quad`; `ts0`/`ts8+` → `any`
- `qp` → `queue` count (design goal, currently missing from cards)

## Join Verdict: YES via steamid

BM exposes `details.serverSteamId` on every server record. Steam exposes `steamid`. These are the same value.

| Source | Field path | Example |
|---|---|---|
| BM | `attributes.details.serverSteamId` | `"90286857894963224"` |
| Steam | `steamid` | `"90286857894963224"` |

**Port-direct join does NOT work**: BM's `port` is the query port (28017), Steam's `addr` uses `gameport` (28015). These differ. Use `steamid` instead.

**IP-only join is a fallback**: works when BM doesn't expose `serverSteamId` (rare).

## BM Fields Confirmed

```
attributes: name, ip, port (query port), players, maxPlayers, rank, status, country
details:    rust_last_wipe, rust_next_wipe, rust_wipes, rust_settings (wipe schedule),
            rust_world_seed, rust_world_size, serverSteamId, rust_queued_players,
            rust_description, rust_modded, rust_gamemode, ...
```

BM's `rust_world_seed` and `rust_world_size` give us map seed/size for the design's map panel — no separate source needed.

## What Each Source Provides

| Data | BM | Steam |
|---|---|---|
| Population history (curves) | ✅ | ❌ |
| Wipe schedule (day/freq) | ✅ | ❌ |
| Next wipe date | ✅ | ❌ |
| Gather rate (2x/5x) | ✅ | ❌ |
| Country/region | ✅ | ❌ |
| Server IP | ✅ | ✅ |
| Game port (connect button) | ❌ | ✅ (`gameport`) |
| Last wipe (born timestamp) | ✅ | ✅ (less reliable) |
| Group limit (team size) | ✅ | ✅ (`ts` token) |
| Queue count | ✅ (`rust_queued_players`) | ✅ (`qp` token) |
| Map name | ✅ | ✅ |
| Map seed / size | ✅ | ❌ |
| Server count | ~300/req (rate limited) | ~10,000/req |

## Architecture Decision

- **BM** = primary source for wipe data, history, curves (the product)
- **Steam** = catalog backbone (10k servers) + game port for direct connect
- **Join key**: `steam_id` (stored on BM records as `details.serverSteamId`)
- **Steam-only servers**: inserted with synthetic ID `steam_{steamid}` — show in results with current pop but no curves ("NO DATA" state)
