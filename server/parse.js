const TITLE_DAY_MAP = {
  monday: 'Monday', mondays: 'Monday',
  tuesday: 'Tuesday', tuesdays: 'Tuesday',
  wednesday: 'Wednesday', wednesdays: 'Wednesday',
  thursday: 'Thursday', thursdays: 'Thursday',
  friday: 'Friday', fridays: 'Friday',
  saturday: 'Saturday', saturdays: 'Saturday',
  sunday: 'Sunday', sundays: 'Sunday',
}

// Extracts type/wipe_day/wipe_freq/group_limit from a server name.
// Used as a fallback in both the BM and Steam pipelines when structured
// API fields are absent.
export function parseTitle(name) {
  if (!name) return {}

  let type = null
  if (/\bvanilla\b/i.test(name)) {
    type = 'vanilla'
  } else {
    const mx = name.match(/\b(\d+)x\b/i)
    if (mx) type = mx[1] + 'x'
  }

  const dayRaw = name.match(/\b(monday|mondays|tuesday|tuesdays|wednesday|wednesdays|thursday|thursdays|friday|fridays|saturday|saturdays|sunday|sundays)\b/i)?.[1]?.toLowerCase()
  const wipe_day = dayRaw ? (TITLE_DAY_MAP[dayRaw] ?? null) : null

  let wipe_freq = null
  if (/\bbi-?weekly\b/i.test(name)) wipe_freq = 'biweekly'
  else if (/\bmonthly\b/i.test(name)) wipe_freq = 'monthly'
  else if (/\bweekly\b/i.test(name)) wipe_freq = 'weekly'

  // Compound patterns first — solo/duo/trio means max group size is trio
  let group_limit = null
  if (/\bsolo[\s/|\\-]{0,3}duo[\s/|\\-]{0,3}trio\b/i.test(name)) group_limit = 'trio'
  else if (/\bsolo[\s/|\\-]{0,3}duo\b/i.test(name)) group_limit = 'duo'
  else if (/\bquad\b/i.test(name)) group_limit = 'quad'
  else if (/\btrio\b/i.test(name)) group_limit = 'trio'
  else if (/\bduo\b/i.test(name)) group_limit = 'duo'
  else if (/\bsolo\b/i.test(name)) group_limit = 'solo'
  if (!group_limit) {
    const mx = name.match(/\bmax\s*(\d+)\b/i)
    if (mx) {
      const lim = parseInt(mx[1], 10)
      if (lim === 1) group_limit = 'solo'
      else if (lim === 2) group_limit = 'duo'
      else if (lim === 3) group_limit = 'trio'
      else if (lim === 4) group_limit = 'quad'
      else group_limit = String(lim)
    }
  }

  return { type, wipe_day, wipe_freq, group_limit }
}
