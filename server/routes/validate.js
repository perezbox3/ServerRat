const VALID_TYPE = new Set(['vanilla', '2x', '3x', '5x', '10x', 'modded', 'official', 'community'])
const VALID_WIPE_DAY = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
const VALID_WIPE_FREQ = new Set(['weekly', 'biweekly', 'monthly'])
const VALID_GROUP = new Set(['solo', 'duo', 'trio', 'quad', 'any'])

export function sanitize(params = {}) {
  const out = {}
  if (VALID_TYPE.has(params.type)) out.type = params.type
  if (VALID_WIPE_DAY.has(params.wipe_day)) out.wipe_day = params.wipe_day
  if (VALID_WIPE_FREQ.has(params.wipe_freq)) out.wipe_freq = params.wipe_freq
  if (VALID_GROUP.has(params.group_limit)) out.group_limit = params.group_limit
  if (/^[A-Z]{2}$/.test(params.region ?? '')) out.region = params.region
  return out
}
