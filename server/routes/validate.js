const VALID_TYPE = new Set(['vanilla', '2x', '3x', '5x', '10x', 'modded', 'official', 'community'])
const VALID_WIPE_DAY = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
const VALID_WIPE_FREQ = new Set(['weekly', 'biweekly', 'monthly'])
const VALID_GROUP = new Set(['solo', 'duo', 'trio', 'quad', 'any'])
const VALID_SORT = new Set(['pop', 'retention', 'health'])

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100

export function sanitize(params = {}) {
  const out = {}
  if (VALID_TYPE.has(params.type)) out.type = params.type
  if (VALID_WIPE_DAY.has(params.wipe_day)) out.wipe_day = params.wipe_day
  if (VALID_WIPE_FREQ.has(params.wipe_freq)) out.wipe_freq = params.wipe_freq
  if (VALID_GROUP.has(params.group_limit)) out.group_limit = params.group_limit
  if (/^[A-Z]{2}$/.test(params.region ?? '')) out.region = params.region
  if (VALID_SORT.has(params.sort)) out.sort = params.sort
  const search = String(params.search ?? '').trim().slice(0, 100)
  if (search) out.search = search
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  out.page = page
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(params.limit ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT))
  out.limit = limit
  return out
}
