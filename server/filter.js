// Fields where a null value on the server means "unknown schedule — exclude when user filters"
const SCHEDULE_FIELDS = ['wipe_day', 'wipe_freq', 'type', 'region']

export function filterServers(servers, criteria) {
  return servers.filter(server => {
    for (const field of SCHEDULE_FIELDS) {
      if (!criteria[field]) continue
      if (server[field] === null) return false
      if (server[field] !== criteria[field]) return false
    }
    if (criteria.group_limit) {
      if (server.group_limit !== 'any' && server.group_limit !== criteria.group_limit) return false
    }
    return true
  })
}

export function scoreMatch(server, curve) {
  return {
    retention: curve?.retention ?? null,
    players: server.current_players ?? 0,
  }
}

function compareScores(a, b) {
  if (a.retention !== null && b.retention === null) return -1
  if (a.retention === null && b.retention !== null) return 1
  if (a.retention !== null && b.retention !== null && a.retention !== b.retention) {
    return b.retention - a.retention
  }
  return b.players - a.players
}

export function rankServers(serversWithCurves, criteria) {
  return filterServers(serversWithCurves, criteria)
    .map(s => ({ s, score: scoreMatch(s, s.curve) }))
    .sort((a, b) => compareScores(a.score, b.score))
    .map(({ s }) => s)
}
