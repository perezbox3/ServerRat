# BattleMetrics API Findings — Task 1 Spike
> Confirmed 2026-06-19. No auth token required for any of the endpoints below.

## Verdict: GREEN — population curve is viable on the free tier

The riskiest assumption is confirmed. BattleMetrics exposes hourly population history
per server with no authentication. Everything needed for the day-1/2/3/5/7 curve exists
in the free public API.

---

## Endpoints Used

### 1. Server List
```
GET https://api.battlemetrics.com/servers
  ?filter[game]=rust
  &page[size]=100
  &filter[status]=online
  &fields[server]=name,players,maxPlayers,rank,status,country,details
```
No token required. Returns up to 100 servers per page. Use `page[offset]` to paginate.

**Useful filter params:**
- `filter[game]=rust`
- `filter[countries][]=US` — region filter
- `filter[search]=vanilla` — name search
- `filter[status]=online`

### 2. Population History (the key endpoint)
```
GET https://api.battlemetrics.com/servers/:id/player-count-history
  ?start=<ISO8601>
  &stop=<ISO8601>
```
No token required. Returns hourly datapoints. Use `wipeTime` as `start` and `wipeTime + 7 days` as `stop` to get the post-wipe population curve.

**Response shape:**
```json
{
  "data": [
    {
      "type": "dataPoint",
      "attributes": {
        "timestamp": "2026-06-19T21:00:00.000Z",
        "max": 1269,
        "value": 1210,
        "min": 1158
      }
    }
  ]
}
```
- `value` = average players during that hour bucket
- `max` / `min` = peak and floor during the hour
- Datapoints are hourly, returned newest-first
- Free tier confirmed: 7-day history available without a token

---

## Key Fields on Server Object (`attributes`)

| Field | What it is | Use |
|---|---|---|
| `players` | Current player count | Live pop display |
| `maxPlayers` | Server capacity | Show "X/Y" |
| `rank` | BattleMetrics rank | Secondary sort |
| `country` | 2-letter country code (e.g. `"US"`) | Region filter |
| `details.rust_last_wipe` | ISO timestamp of last wipe | Anchor for curve query |
| `details.rust_next_wipe` | ISO timestamp of next scheduled wipe | Show countdown |
| `details.rust_wipes` | Array of upcoming wipe timestamps + types | Schedule display |
| `details.rust_settings.wipes` | Recurring wipe schedule (days, weeks, type, hour) | "Wipes every Thursday" label |
| `details.rust_settings.groupLimit` | Max group size (999999 = no limit) | Group filter |
| `details.rust_settings.rates.gather` | Gather rate multiplier (1 = vanilla, 2 = 2x) | Rate filter |
| `details.rust_type` | `"official"` / `"modded"` / `"community"` | Type filter |
| `details.official` | Boolean — Facepunch official | Official filter |
| `details.pve` | Boolean — PvE mode | Filter |
| `details.rust_description` | Server description text | Card display |
| `details.rust_url` | Server website | Card link |

---

## Population Curve Algorithm

Given `rust_last_wipe` timestamp and the history endpoint:

```
1. Fetch /servers/:id/player-count-history
     start = rust_last_wipe
     stop  = rust_last_wipe + 8 days

2. Group hourly datapoints into day buckets:
     day 1 = hours 0–23 after wipe
     day 2 = hours 24–47 after wipe
     ... etc

3. Average the `value` field per bucket → { day1, day2, day3, day5, day7 }

4. Retention score = day3.avg / day1.avg  (0–1, higher = better retention)
```

Edge cases to handle:
- Server wiped less than N days ago → day N is null (not enough data yet)
- Datapoints missing for a window (server was offline) → treat as 0 or null
- `rust_last_wipe` is null → skip curve computation, show "no wipe data"

---

## Wipe Schedule Parsing

The `rust_settings.wipes` array gives the recurring schedule. Example:
```json
{
  "weeks": [1, 1, 1, 1, 1],
  "days": ["TU", "FR"],
  "type": "full",
  "hour": 5,
  "minute": 30
}
```
- `days`: which days of week (MO/TU/WE/TH/FR/SA/SU)
- `weeks`: which weeks in the month (1-indexed, 5 = last week)
- `hour`/`minute`: UTC time of wipe
- `type`: `"full"` or `"map"` (map-only wipe keeps blueprints)

The upcoming `rust_wipes` array is simpler — it's just pre-computed future timestamps we can display directly.

---

## Rate Limits (free tier)

Not precisely documented by BattleMetrics, but observed:
- Server list: no issues at 1 req/sec
- Player count history: no issues at 1 req/sec per server
- **Cache aggressively.** Server list: cache 5 minutes. Population history: cache 1 hour (data only updates hourly anyway).

---

## What We Don't Need

- A BattleMetrics API token for MVP (all endpoints confirmed without auth)
- A2S direct server queries (BattleMetrics data is sufficient)
- The `/players` endpoint (player tracking, not needed)
- Paid tier features

---

## Out of Scope (but exists in the API if needed later)

- `/players` — track specific players across servers
- Server groups / org features (paid)
- Real-time WebSocket feed (paid)


---

## Backfill Spike — 2026-06-22

**Verdict: BACKFILL WITH FLOOR**

| Metric | Value |
|---|---|
| Servers probed | 100 |
| Success rate | 80.0% |
| 429s hit | 0 |
| 400s hit | 20 |
| Servers yielding a curve | 56 / 80 (70.0%) |
| Median datapoints / server | 59 |
| Wall time for 100 servers | 128.5s |
| Estimated full-catalog sweep (~3k servers) | ~64 min |

**Scope for Task 2:** Backfill BM servers above a population floor (e.g. current_players >= 10) to stay within rate budget. Population floor: `current_players >= 10`.
