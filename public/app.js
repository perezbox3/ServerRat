import { renderSparkline } from './sparkline.js'

// ── Meta / constants ─────────────────────────────────────────────────────────

const TYPES = ['vanilla', '2x', '3x', '5x', '10x']
const GROUPS = ['solo', 'duo', 'trio', 'quad', 'any']
const FREQS = ['weekly', 'biweekly', 'monthly']
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const REGIONS = ['US', 'DE', 'GB', 'FR', 'NL', 'AU']

const TYPE_LABEL = { vanilla: 'Vanilla', '2x': '2x', '3x': '3x', '5x': '5x', '10x': '10x' }
const GROUP_LABEL = { solo: 'Solo', duo: 'Duo', trio: 'Trio', quad: 'Quad', any: 'Any' }
const FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' }
const DAY_SHORT = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
}

const HEALTH = {
  healthy: { cls: 'h-strong', label: 'HOLDS' },
  fading:  { cls: 'h-fading', label: 'FADES' },
  dying:   { cls: 'h-dead',   label: 'DIES'  },
  unknown: { cls: 'h-unknown', label: 'NO DATA' },
}

// ── HTML escape (all BM-sourced strings must pass through this) ───────────────

function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Routing ──────────────────────────────────────────────────────────────────

function getRoute() {
  const raw = location.hash.slice(1) || 'landing'
  const [screen, qs] = raw.split('?')
  return { screen: screen || 'landing', params: new URLSearchParams(qs || '') }
}

function go(screen, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString()
  location.hash = qs ? `${screen}?${qs}` : screen
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchServers(filters = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
  ).toString()
  const res = await fetch('/api/servers' + (qs ? '?' + qs : ''))
  if (!res.ok) throw new Error('fetch servers failed')
  return res.json()
}

async function fetchServer(id) {
  const res = await fetch('/api/servers/' + encodeURIComponent(id))
  if (!res.ok) throw new Error('fetch server failed')
  return res.json()
}

async function postMatch(criteria) {
  const res = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(criteria),
  })
  if (!res.ok) throw new Error('match failed')
  return res.json()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCurve(curve) {
  if (!curve) return null
  if (Array.isArray(curve.values)) return curve
  // POST /api/match returns { day1, day2, day3, day5, day7, retention }
  const values = [curve.day1, curve.day2, curve.day3, curve.day5, curve.day7]
  return { values, health: retentionToHealth(curve.retention), retention: curve.retention }
}

function retentionToHealth(r) {
  if (r == null) return 'unknown'
  if (r >= 0.7) return 'healthy'
  if (r >= 0.4) return 'fading'
  return 'dying'
}

function healthInfo(h) { return HEALTH[h] || HEALTH.unknown }

function fmtPop(n) { return n != null ? String(n) : '—' }

function fmtRet(r) { return r != null ? `${Math.round(r * 100)}%` : '—' }

function retClass(r) {
  if (r == null) return ''
  return r >= 0.7 ? 'ok' : r >= 0.4 ? 'mid' : 'bad'
}

function debounce(fn, ms) {
  let t
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

function renderPop30(pop30, maxPlayers) {
  const nonNull = (pop30 ?? []).filter(v => v !== null)
  if (!nonNull.length) return '<div class="cc-nodata">no history yet — check back after a day</div>'
  const W = 660, H = 120, padL = 4, padR = 4, padT = 6, padB = 4
  const n = pop30.length
  const ceil = Math.max(maxPlayers || 1, ...nonNull)
  const bw = (W - padL - padR) / n
  const barY = v => padT + (1 - v / ceil) * (H - padT - padB)
  const barCol = v => {
    if (v == null) return 'var(--edge)'
    const rt = v / ceil
    return rt >= 0.55 ? 'var(--pop)' : rt >= 0.28 ? 'var(--accent)' : 'var(--rust)'
  }
  const bars = pop30.map((v, i) => {
    const by = v != null ? barY(v) : H - padB - 2
    const bh = v != null ? Math.max(1, H - padB - barY(v)) : 2
    return `<rect x="${(padL + i * bw + 1).toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${barCol(v)}" />`
  }).join('')
  return `<svg class="c30-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" shape-rendering="crispEdges">${bars}</svg>
    <div class="c30-x"><span>30d ago</span><span>20d</span><span>10d</span><span>today</span></div>`
}

function renderWipeHistory(wipeHistory) {
  if (!wipeHistory?.length) return '<div class="cc-nodata">no previous wipes in the history window yet</div>'
  return `<div class="wipe-list">${wipeHistory.map(w => {
    const ret = w.retention !== null ? Math.round(w.retention * 100) : null
    const retCls = ret == null ? '' : ret >= 70 ? 'ok' : ret >= 40 ? 'mid' : 'bad'
    const fillPct = ret !== null ? Math.min(100, ret) : 0
    const dateStr = w.wipe_date
      ? new Date(w.wipe_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—'
    return `<div class="wipe-row" style="grid-template-columns:100px 120px 1fr 120px">
      <span class="wr-date">${esc(dateStr)}</span>
      <span class="wr-peak data">${w.peak != null ? esc(String(w.peak)) + ' peak' : '—'}</span>
      <span class="wr-bar"><span class="wr-fill" style="width:${fillPct}%"></span></span>
      <span class="wr-held data ${retCls}">${ret !== null ? ret + '% ret' : '—'}</span>
    </div>`
  }).join('')}</div>`
}

function daysSince(iso) {
  if (!iso) return null
  const d = (Date.now() - new Date(iso).getTime()) / 86400000
  if (d < 1) return Math.round(d * 24) + 'h ago'
  return Math.round(d) + 'd ago'
}

function daysUntil(iso) {
  if (!iso) return null
  const d = (new Date(iso).getTime() - Date.now()) / 86400000
  if (d <= 0) return 'soon'
  if (d < 1) return Math.round(d * 24) + 'h'
  return Math.round(d) + 'd'
}

function fileNo(name) {
  return String(name.length * 7 + 1024).padStart(4, '0')
}

// ── Shared UI pieces ─────────────────────────────────────────────────────────

function healthTag(health) {
  const h = healthInfo(health)
  return `<span class="htag ${h.cls}">${h.label}</span>`
}

function typeBadge(type) {
  const van = type === 'vanilla' ? ' van' : ''
  const label = TYPE_LABEL[type] || esc(type) || '—'
  return `<span class="tbadge${van}">${label}</span>`
}

function popLive(s) {
  return `<div class="poplive">
    <span class="dot"></span>
    <span class="pnum">${fmtPop(s.current_players)}</span>
    <span class="pmax">/${fmtPop(s.max_players)}</span>
  </div>`
}

function chip(label, active, attrs = '') {
  return `<button class="fchip${active ? ' on' : ''}" ${attrs}>${label}</button>`
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function renderNav(screen) {
  const links = [
    { k: 'landing', label: 'Home' },
    { k: 'results', label: 'Find Servers' },
    { k: 'match',   label: 'Match Me' },
  ]
  return `<nav class="srnav">
    <button class="brand" data-nav="landing">
      <span class="brand-mark"><img class="px" src="assets/sr-head.png" alt="ServerRat" /></span>
      <span class="brand-name">SERVER<span class="amber">RAT</span></span>
    </button>
    <ul class="srnav-links">
      ${links.map((n, i) => `<li class="${screen === n.k ? 'on' : ''}" data-nav="${n.k}">
        <span class="nl-idx">${String(i + 1).padStart(2, '0')}</span>${n.label}
      </li>`).join('')}
    </ul>
    <button class="srnav-cta" data-nav="match">MATCH ME →</button>
  </nav>`
}

// ── Footer ───────────────────────────────────────────────────────────────────

function renderFooter() {
  return `<footer class="srfoot">
    <span class="foot-brand">SERVER<span class="amber">RAT</span> // perezbox3</span>
    <a class="foot-projects" href="https://perezbox3.com" target="_blank" rel="noopener">Find more of my projects at <b>perezbox3.com</b> →</a>
    <span class="foot-right">
      <button class="foot-link" data-nav="privacy">Privacy Policy</button>
      <span class="dim">pop refreshes every 5 min</span>
    </span>
  </footer>`
}

// ── Server card ──────────────────────────────────────────────────────────────

function renderCard(s, opts = {}) {
  const curve = normalizeCurve(s.curve)
  const health = curve?.health || 'unknown'
  const h = healthInfo(health)
  const strong = health === 'healthy' || health === 'fading'
  const wipeSummary = [DAY_SHORT[s.wipe_day], FREQ_LABEL[s.wipe_freq]].filter(Boolean).join(' · ') || '—'

  let curveSection
  if (curve?.values) {
    const svg = renderSparkline(curve.values, { id: s.id, strong })
    const retHtml = curve.retention != null
      ? `<div class="retrow">
          <div class="ret"><span class="rk">D3</span>
            <span class="rv ${retClass(curve.retention)}">${fmtRet(curve.retention)}</span></div>
         </div>`
      : ''
    curveSection = `
      <div class="dz-curve-head"><span class="curve-label">POP CURVE</span>${retHtml}</div>
      ${svg}
      <div class="dz-axis"><span>D1</span><span>D2</span><span>D3</span><span>D5</span><span>D7</span></div>`
  } else if (opts.loadingCurve) {
    curveSection = `
      <div class="dz-curve-head"><span class="curve-label">POP CURVE</span></div>
      <div class="emptycurve" id="curve-${esc(s.id)}">
        <div class="ec-txt"><div class="ec-h">LOADING</div><div class="ec-p">fetching population history…</div></div>
      </div>`
  } else {
    curveSection = `
      <div class="dz-curve-head"><span class="curve-label">POP CURVE</span></div>
      <div class="emptycurve">
        <div class="ec-mascot"><img src="assets/sr-mascot.png" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated" alt="" /></div>
        <div class="ec-txt"><div class="ec-h">UNMAPPED</div><div class="ec-p">The rat hasn't scouted this one yet.</div></div>
      </div>`
  }

  const verdict = s.next_wipe
    ? `next wipe in ${daysUntil(s.next_wipe)}`
    : s.last_wipe
    ? `last wiped ${daysSince(s.last_wipe)}`
    : '—'

  return `<article class="card dossier ${h.cls}" role="button" tabindex="0" data-open="${esc(s.id)}">
    <div class="dz-stamp">${esc(s.region) || '—'}</div>
    <header class="dz-head">
      <div class="dz-file">FILE №${fileNo(s.name)}</div>
      <h3 class="dz-name">${esc(s.name)}</h3>
      <div class="dz-tags">
        ${typeBadge(s.type)}
        <span class="meta-pill">${GROUP_LABEL[s.group_limit] || esc(s.group_limit) || '—'}</span>
        <span class="meta-pill">${wipeSummary}</span>
      </div>
    </header>
    <div class="dz-pop">
      ${popLive(s)}
      ${s.queue > 0 ? `<span class="queue-pill">+${esc(String(s.queue))} queue</span>` : ''}
      ${healthTag(health)}
    </div>
    <div class="dz-curve">${curveSection}</div>
    <footer class="dz-verdict">
      <span class="vk">RAT SAYS</span>
      <span class="vt">${verdict}</span>
      <span class="card-go">DOSSIER →</span>
    </footer>
  </article>`
}

// ── Results screen ───────────────────────────────────────────────────────────

function filterSidebar(params) {
  const f = {
    type: params.get('type') || '',
    wipe_day: params.get('wipe_day') || '',
    wipe_freq: params.get('wipe_freq') || '',
    group_limit: params.get('group_limit') || '',
    region: params.get('region') || '',
    search: params.get('search') || '',
    alive: params.get('alive') === '1',
  }

  function filterChips(values, field, labelMap) {
    return values.map(v =>
      chip(labelMap[v] || v, f[field] === v, `data-filter="${field}" data-value="${esc(v)}"`)
    ).join('')
  }

  return `<aside class="sidebar">
    <div class="sb-formhead">
      <div class="sf-stamp mono">FIELD FORM 7-B</div>
      <div class="sf-title">FILTER THE MAP</div>
      <div class="sf-rule"></div>
    </div>

    <div class="fgroup">
      <div class="fg-label mono">SEARCH</div>
      <div class="fg-body">
        <div class="sb-field" style="border:none;padding:6px 0 0">
          <span class="sb-prompt mono" style="font-size:16px">&gt;</span>
          <input class="sb-input" id="search-input" type="text" placeholder="server name…"
            value="${esc(f.search)}" style="font-size:16px" />
        </div>
        <button class="sb-search-btn mono" data-search-go>SEARCH →</button>
      </div>
    </div>

    <div class="fgroup">
      <div class="fg-label mono">REGION</div>
      <div class="fg-body"><div class="chiprow">
        ${filterChips(REGIONS, 'region', {})}
      </div></div>
    </div>

    <div class="fgroup">
      <div class="fg-label mono">WIPE DAY</div>
      <div class="fg-body"><div class="chiprow">
        ${filterChips(DAYS, 'wipe_day', DAY_SHORT)}
      </div></div>
    </div>

    <div class="fgroup">
      <div class="fg-label mono">FREQUENCY</div>
      <div class="fg-body"><div class="chiprow">
        ${filterChips(FREQS, 'wipe_freq', FREQ_LABEL)}
      </div></div>
    </div>

    <div class="fgroup">
      <div class="fg-label mono">SERVER TYPE</div>
      <div class="fg-body"><div class="chiprow">
        ${filterChips(TYPES, 'type', TYPE_LABEL)}
      </div></div>
    </div>

    <div class="fgroup">
      <div class="fg-label mono">GROUP LIMIT</div>
      <div class="fg-body"><div class="chiprow">
        ${filterChips(GROUPS, 'group_limit', GROUP_LABEL)}
      </div></div>
    </div>

    <label class="fcheck">
      <input type="checkbox" data-filter="alive" ${f.alive ? 'checked' : ''} />
      <span>Hide servers that die by day 3</span>
    </label>

    <button class="sb-reset mono" data-reset>↺ CLEAR FORM</button>
  </aside>`
}

function renderPagination(pagination, params) {
  const { total, page, limit } = pagination
  const totalPages = Math.ceil(total / limit) || 1
  if (total === 0) return ''
  const prevParams = new URLSearchParams(params)
  prevParams.set('page', page - 1)
  const nextParams = new URLSearchParams(params)
  nextParams.set('page', page + 1)
  return `<div class="pagination">
    <button class="pg-btn" data-pg="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← PREV</button>
    <span class="pg-info mono">PAGE ${page} / ${totalPages} · ${total.toLocaleString()} SERVERS</span>
    <button class="pg-btn" data-pg="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>NEXT →</button>
  </div>`
}

function renderResults(servers, params, pagination) {
  const sort = params.get('sort') || 'pop'
  const cards = servers.map(s => renderCard(s, { loadingCurve: true })).join('')
  return `<div class="screen results">
    ${filterSidebar(params)}
    <main class="resmain">
      <div class="res-bar">
        <div class="res-count">
          <span class="rc-num mono">${(pagination?.total ?? servers.length).toLocaleString()}</span>
          <span class="rc-lbl">servers mapped</span>
        </div>
        <div class="res-sort">
          <span class="rs-lbl mono">SORT</span>
          <button class="rs-opt${sort === 'pop' ? ' on' : ''}" data-sort="pop">Live Pop</button>
          <button class="rs-opt${sort === 'retention' ? ' on' : ''}" data-sort="retention">Retention</button>
          <button class="rs-opt${sort === 'health' ? ' on' : ''}" data-sort="health">Health</button>
        </div>
      </div>
      <div class="cardgrid grid-dossier" id="card-grid">
        ${cards || '<div class="noresults">// no servers match the form. clear a filter.</div>'}
      </div>
      ${pagination ? renderPagination(pagination, params) : ''}
    </main>
  </div>`
}

// ── Detail screen ─────────────────────────────────────────────────────────────

function renderDetail(s, backScreen) {
  const curve = normalizeCurve(s.curve)
  const health = curve?.health || 'unknown'
  const h = healthInfo(health)
  const strong = health === 'healthy' || health === 'fading'
  const wipeSummary = [DAY_SHORT[s.wipe_day], FREQ_LABEL[s.wipe_freq]].filter(Boolean).join(' · ') || '—'

  let curvePanel
  if (curve?.values) {
    const svg = renderSparkline(curve.values, { id: s.id + '-d', w: 300, h: 84, strong })
    const d3Ret = fmtRet(curve.retention)
    const d7ratio = (curve.values[4] != null && curve.values[0] != null && curve.values[0] !== 0)
      ? curve.values[4] / curve.values[0]
      : null
    const d7Ret = fmtRet(d7ratio)
    curvePanel = `
      <div class="ret-panel">
        ${svg}
        <div class="dz-axis"><span>D1</span><span>D2</span><span>D3</span><span>D5</span><span>D7</span></div>
        <div class="retrow ret-big">
          <div class="ret"><span class="rk">D3</span><span class="rv ${retClass(curve.retention)}">${d3Ret}</span></div>
          <div class="ret"><span class="rk">D7</span><span class="rv ${retClass(d7ratio)}">${d7Ret}</span></div>
        </div>
      </div>`
  } else {
    curvePanel = '<div class="cc-nodata">NO DATA YET</div>'
  }

  const verdict = s.next_wipe
    ? `next wipe in ${daysUntil(s.next_wipe)}`
    : s.last_wipe
    ? `last wiped ${daysSince(s.last_wipe)}`
    : '—'

  // Stat chips computed from pop30 array
  const nonNull = (s.pop30 ?? []).filter(v => v !== null)
  const avg30 = nonNull.length ? Math.round(nonNull.reduce((a, b) => a + b, 0) / nonNull.length) : null
  const peak30 = nonNull.length ? Math.max(...nonNull) : null
  const floor30 = nonNull.length ? Math.min(...nonNull) : null
  const statRow = nonNull.length ? `
    <div class="statrow">
      ${avg30 != null ? `<div class="statchip"><div class="sc-v ok">${avg30}</div><div class="sc-k">30-DAY AVG</div></div>` : ''}
      ${peak30 != null ? `<div class="statchip"><div class="sc-v">${peak30}</div><div class="sc-k">PEAK</div></div>` : ''}
      ${floor30 != null ? `<div class="statchip"><div class="sc-v ${floor30 < (s.max_players || 1) * 0.15 ? 'bad' : ''}">${floor30}</div><div class="sc-k">FLOOR</div></div>` : ''}
    </div>` : ''

  const mapPanel = s.map_url ? `
    <section class="panel dt-map">
      <div class="panel-head">
        <span class="panel-title">THE MAP</span>
        <span class="panel-sub">${s.map_seed != null ? 'seed ' + esc(String(s.map_seed)) : esc(s.map_name) || 'Procedural'}</span>
      </div>
      <div class="panel-body map-body">
        ${s.map_thumbnail ? `<a class="map-thumb-link" href="${esc(s.map_url)}" target="_blank" rel="noopener noreferrer">
          <img class="map-thumb-img" src="${esc(s.map_thumbnail)}" alt="Rust map" loading="lazy" />
        </a>` : ''}
        <a class="btn-map-link" href="${esc(s.map_url)}" target="_blank" rel="noopener noreferrer">VIEW FULL MAP ON RUSTMAPS →</a>
      </div>
    </section>` : `
    <section class="panel dt-map">
      <div class="panel-head"><span class="panel-title">THE MAP</span></div>
      <div class="panel-body"><div class="cc-nodata">map not available yet</div></div>
    </section>`

  return `<div class="screen detail">
    <button class="dt-back" data-nav="${esc(backScreen)}">← BACK TO MAP</button>

    <header class="dt-head">
      <div class="dt-head-l">
        <div class="dz-file">FILE №${fileNo(s.name)} · ${esc(s.region) || '—'}</div>
        <h1 class="dt-name">${esc(s.name)}</h1>
        <div class="dt-tags">
          ${typeBadge(s.type)}
          <span class="meta-pill">${GROUP_LABEL[s.group_limit] || esc(s.group_limit) || '—'}</span>
          <span class="meta-pill">${wipeSummary}</span>
        </div>
        <div class="dt-verdict">
          <span class="vk">RAT SAYS</span>
          <span class="vt">${verdict}</span>
          ${health === 'healthy' ? '<span class="smiley"></span>' : ''}
        </div>
      </div>
      <div class="dt-head-r">
        <div class="dt-popbox">
          ${popLive(s)}
          ${healthTag(health)}
        </div>
        ${s.next_wipe ? `<div class="dt-next">NEXT WIPE <b>${daysUntil(s.next_wipe)}</b></div>` : ''}
        ${s.ip && s.game_port ? `<div class="connect">
          <span class="cn-lbl">CONNECT</span>
          <code class="cn-ip">${esc(s.ip)}:${esc(String(s.game_port))}</code>
          <button class="copy-btn" data-copy="${esc(s.ip)}:${esc(String(s.game_port))}">COPY</button>
          <a class="connect-link" href="steam://connect/${esc(s.ip)}:${esc(String(s.game_port))}">LAUNCH →</a>
        </div>` : ''}
      </div>
    </header>

    <div class="dt-grid">
      ${mapPanel}

      <section class="panel dt-chart">
        <div class="panel-head">
          <span class="panel-title">POPULATION · LAST 30 DAYS</span>
          <span class="panel-sub">avg concurrent players / day</span>
        </div>
        <div class="panel-body">
          ${renderPop30(s.pop30, s.max_players)}
          ${statRow}
        </div>
      </section>
    </div>

    <div class="dt-row3">
      <section class="panel">
        <div class="panel-head">
          <span class="panel-title">WIPE RETENTION</span>
          <span class="panel-sub">this wipe · day 1→7</span>
        </div>
        <div class="panel-body">${curvePanel}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><span class="panel-title">ABOUT</span></div>
        <div class="panel-body">
          ${s.description
            ? `<div class="desc-body">${esc(s.description).replace(/\n/g, '<br/>')}</div>`
            : '<div class="cc-nodata">no description provided</div>'}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><span class="panel-title">SERVER FACTS</span></div>
        <div class="panel-body">
          <dl class="facts">
            <div><dt>Region</dt><dd>${esc(s.region) || '—'}</dd></div>
            <div><dt>Wipe</dt><dd>${wipeSummary}</dd></div>
            <div><dt>Group limit</dt><dd>${GROUP_LABEL[s.group_limit] || esc(s.group_limit) || '—'}</dd></div>
            <div><dt>Type</dt><dd>${TYPE_LABEL[s.type] || esc(s.type) || '—'}</dd></div>
            <div><dt>Slots</dt><dd>${fmtPop(s.max_players)}</dd></div>
            <div><dt>Last wiped</dt><dd>${s.last_wipe ? daysSince(s.last_wipe) : '—'}</dd></div>
            ${s.next_wipe ? `<div><dt>Next wipe</dt><dd>${daysUntil(s.next_wipe)}</dd></div>` : ''}
            ${s.queue > 0 ? `<div><dt>Queue</dt><dd>${esc(String(s.queue))} waiting</dd></div>` : ''}
            ${s.url ? `<div><dt>Website</dt><dd><a class="facts-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a></dd></div>` : ''}
          </dl>
        </div>
      </section>
    </div>

    <section class="panel dt-wipes" style="margin-bottom:22px">
      <div class="panel-head">
        <span class="panel-title">WIPE HISTORY</span>
        <span class="panel-sub">up to last 4 wipes</span>
      </div>
      <div class="panel-body">${renderWipeHistory(s.wipe_history)}</div>
    </section>
  </div>`
}

// ── Landing screen ────────────────────────────────────────────────────────────

function renderLanding(featured) {
  const healthyPicks = featured.filter(s => normalizeCurve(s.curve)?.health === 'healthy').slice(0, 3)
  // Fallback to most-active servers if retention data isn't loaded yet
  const picks = healthyPicks.length > 0 ? healthyPicks : featured.slice(0, 3)

  return `<div class="screen landing">
    <section class="hero hero-split">
      <div class="hs-left">
        <div class="headline left">
          <div class="kicker">// THE RAT HAS MAPPED THE TUNNELS</div>
          <h1 class="h-display">
            Find a server<br />that doesn't die<br />by <span class="amber">day 3</span>.
          </h1>
          <p class="lede">
            Wipe-day pop means nothing. ServerRat tracks who's <em>still online</em> on day 5, day 7,
            right up to next wipe — so you don't grind a base nobody raids.
          </p>
        </div>
        <div class="searchbar" style="margin-top:32px">
          <div class="sb-field">
            <span class="sb-prompt mono">&gt;</span>
            <input class="sb-input" id="land-search" type="text" placeholder="server name, tag, or vibe…" />
          </div>
          <div class="sb-quick" style="padding:14px 16px">
            <select class="sb-sel mono" id="land-region">
              <option value="">Any region</option>
              ${REGIONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
            </select>
            <select class="sb-sel mono" id="land-type">
              <option value="">Any type</option>
              ${TYPES.map(t => `<option value="${esc(t)}">${TYPE_LABEL[t] || esc(t)}</option>`).join('')}
            </select>
            <button class="btn-amber" data-land-go>SCAN SERVERS →</button>
          </div>
        </div>
      </div>
      <div class="hs-right">
        <div class="ratslot rat-big">
          <div class="rat-grime"></div>
          <img src="assets/sr-mascot.png" alt="ServerRat mascot" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated" />
          <div class="rat-tag">UNIT: SERVERRAT // STILL ALIVE</div>
        </div>
      </div>
    </section>

    ${picks.length ? `<div class="featured">
      <div class="feat-head">
        <span class="curve-label">RAT'S TOP PICKS THIS WIPE</span>
        <span class="smiley"></span>
        <span class="feat-sub">held ≥70% pop to day 7</span>
        <span class="rule"></span>
      </div>
      <div class="feat-grid">${picks.map(s => renderCard(s)).join('')}</div>
    </div>` : ''}

    <section class="how">
      <div class="how-step"><span class="hs-n mono">01</span><span>Pick your wipe day, group size &amp; region.</span></div>
      <div class="how-step"><span class="hs-n mono">02</span><span>ServerRat ranks by <b>pop retention</b>, not wipe-day spikes.</span></div>
      <div class="how-step"><span class="hs-n mono">03</span><span>Match servers to <b>your</b> play hours. Land where people log in.</span></div>
    </section>
  </div>`
}

// ── Match screen ──────────────────────────────────────────────────────────────

function renderMatchScreen(results, submitted, criteria) {
  function matchChip(label, field, value) {
    const active = criteria[field] === value
    return chip(label, active, `data-match="${field}" data-value="${esc(value)}"`)
  }

  const hasResult = submitted && results !== null

  return `<div class="screen match">
    <div class="match-head">
      <div class="kicker">// OVERLAP ENGINE</div>
      <h2 class="h-display match-title">When do <span class="amber">you</span> play?</h2>
      <p class="lede match-lede">Tell the rat your crew and schedule. He surfaces the servers with people
      online when you are — ranked by who actually <em>holds</em> population.</p>
    </div>

    <div class="match-body">
      <div class="match-form">
        <div class="fgroup">
          <div class="fg-label mono">WIPE DAY</div>
          <div class="fg-body"><div class="chiprow">
            ${DAYS.map(d => matchChip(DAY_SHORT[d], 'wipe_day', d)).join('')}
          </div></div>
        </div>
        <div class="fgroup">
          <div class="fg-label mono">FREQUENCY</div>
          <div class="fg-body"><div class="chiprow">
            ${FREQS.map(f => matchChip(FREQ_LABEL[f], 'wipe_freq', f)).join('')}
          </div></div>
        </div>
        <div class="fgroup">
          <div class="fg-label mono">REGION</div>
          <div class="fg-body"><div class="chiprow">
            ${REGIONS.map(r => matchChip(r, 'region', r)).join('')}
          </div></div>
        </div>
        <div class="fgroup">
          <div class="fg-label mono">YOUR CREW</div>
          <div class="fg-body"><div class="chiprow">
            ${GROUPS.map(g => matchChip(GROUP_LABEL[g], 'group_limit', g)).join('')}
          </div></div>
        </div>
        <div class="fgroup">
          <div class="fg-label mono">SERVER TYPE</div>
          <div class="fg-body"><div class="chiprow">
            ${TYPES.map(t => matchChip(TYPE_LABEL[t], 'type', t)).join('')}
          </div></div>
        </div>
        <button class="btn-amber match-go" data-match-submit>FIND MY SERVERS →</button>
      </div>

      <div class="match-results">
        <div class="mr-rat">
          <img src="assets/sr-mascot.png" alt="ServerRat" style="width:118px;height:118px;object-fit:contain;image-rendering:pixelated" />
          <div class="mr-speech">
            ${!submitted
              ? 'Set your crew and schedule — the rat will point you at servers that hold.'
              : hasResult && results.length
              ? `${results.length} servers ranked by retention. Top picks below.`
              : hasResult
              ? 'Nothing matches that combo. Loosen a filter.'
              : 'Searching…'}
          </div>
        </div>
        <div class="mr-list" id="match-list">
          ${hasResult ? results.slice(0, 5).map(s => {
            const c = normalizeCurve(s.curve)
            return `<div class="mr-item">
              <div class="mr-score">
                <span class="mr-pct">${c?.retention != null ? Math.round(c.retention * 100) : '—'}</span>
                <span class="mr-pctl">ret%</span>
              </div>
              <div class="mr-right">${renderCard(s)}</div>
            </div>`
          }).join('') : ''}
        </div>
      </div>
    </div>
  </div>`
}

// ── Privacy screen ────────────────────────────────────────────────────────────

function renderPrivacy(backScreen) {
  return `<div class="screen privacy" style="max-width:700px">
    <button class="dt-back" data-nav="${esc(backScreen)}">← BACK</button>
    <h1 class="h-display" style="margin-top:32px">Privacy Policy</h1>
    <div class="lede" style="margin-top:24px;max-width:none">
      <p>ServerRat does not collect any personal data. There are no accounts, no login, no cookies beyond what your browser sets locally.</p>
      <p>Rust server data is sourced from the <a href="https://www.battlemetrics.com" target="_blank" rel="noopener" style="color:var(--accent)">BattleMetrics</a> public API. No player tracking is performed.</p>
      <p>This is a free tool built by perezbox3. Use it to find better Rust servers.</p>
    </div>
  </div>`
}

// ── App state ─────────────────────────────────────────────────────────────────

const app = {
  servers: [],
  pagination: { total: 0, page: 1, limit: 25 },
  detailServer: null,
  matchCriteria: {},
  matchResults: null,
  matchSubmitted: false,
}

// ── Lazy curve loader ─────────────────────────────────────────────────────────

async function injectCurves(servers, { aliveOnly = false } = {}) {
  const limit = aliveOnly ? 25 : 10
  const todo = servers.filter(s => !s.curve).slice(0, limit)
  await Promise.all(todo.map(async s => {
    try {
      const full = await fetchServer(s.id)
      const el = document.getElementById('curve-' + s.id)
      // Skip if element was removed by a navigation that happened while fetching
      if (!el || !el.isConnected || !full.curve) return
      const curve = normalizeCurve(full.curve)
      const health = curve?.health || 'unknown'
      const strong = health === 'healthy' || health === 'fading'
      if (curve?.values) {
        const svg = renderSparkline(curve.values, { id: s.id, strong })
        const retHtml = curve.retention != null
          ? `<div class="retrow" style="margin-top:6px">
              <div class="ret"><span class="rk">D3</span>
                <span class="rv ${retClass(curve.retention)}">${fmtRet(curve.retention)}</span></div>
             </div>`
          : ''
        el.parentElement.innerHTML = `
          <div class="dz-curve-head"><span class="curve-label">POP CURVE</span>${retHtml}</div>
          ${svg}
          <div class="dz-axis"><span>D1</span><span>D2</span><span>D3</span><span>D5</span><span>D7</span></div>`
        const card = el.closest?.('.card')
        if (card) {
          card.className = `card dossier ${healthInfo(health).cls}`
          const htag = card.querySelector('.htag')
          if (htag) {
            htag.className = `htag ${healthInfo(health).cls}`
            htag.textContent = healthInfo(health).label
          }
        }
      } else {
        el.innerHTML = '<div class="ec-h">NO DATA YET</div>'
      }
    } catch {
      // silently skip — curve is a progressive enhancement
    }
  }))

  // After all curves loaded: hide confirmed-dead servers if alive filter is on
  if (aliveOnly) {
    document.querySelectorAll('#card-grid .card.h-dead').forEach(el => el.remove())
    const remaining = document.querySelectorAll('#card-grid .card').length
    const countEl = document.querySelector('.rc-num')
    if (countEl) countEl.textContent = remaining
  }
}

// ── Main render (generation counter prevents stale writes) ────────────────────

let _renderGen = 0

async function render() {
  const gen = ++_renderGen
  const { screen, params } = getRoute()
  const mount = document.getElementById('app')

  if (screen === 'landing') {
    mount.innerHTML = renderNav('landing') +
      '<div class="stage">' + renderLanding(app.servers) + '</div>' +
      renderFooter()
    if (!app.servers.length) {
      try {
        const fetched = await fetchServers({ limit: 25 })
        if (gen !== _renderGen) return
        app.servers = fetched.servers ?? fetched
        mount.innerHTML = renderNav('landing') +
          '<div class="stage">' + renderLanding(app.servers) + '</div>' +
          renderFooter()
      } catch { /* no featured picks — ok */ }
    }

  } else if (screen === 'results') {
    mount.innerHTML = renderNav('results') +
      '<div class="stage"><div class="screen results"><div class="resmain"><div class="noresults">// loading servers…</div></div></div></div>' +
      renderFooter()
    try {
      const fetched = await fetchServers(Object.fromEntries(params))
      if (gen !== _renderGen) return
      app.servers = fetched.servers ?? fetched
      app.pagination = { total: fetched.total ?? app.servers.length, page: fetched.page ?? 1, limit: fetched.limit ?? 25 }
    } catch {
      if (gen !== _renderGen) return
      mount.innerHTML = renderNav('results') +
        '<div class="stage"><div class="screen results"><div class="resmain"><div class="noresults">// error loading servers. try again.</div></div></div></div>' +
        renderFooter()
      return
    }
    mount.innerHTML = renderNav('results') +
      '<div class="stage">' + renderResults(app.servers, params, app.pagination) + '</div>' +
      renderFooter()
    injectCurves(app.servers, { aliveOnly: params.get('alive') === '1' })

  } else if (screen === 'detail') {
    const id = params.get('id')
    const back = params.get('back') || 'results'
    mount.innerHTML = renderNav('detail') +
      '<div class="stage"><div class="screen detail"><div class="noresults">// loading dossier…</div></div></div>' +
      renderFooter()
    try {
      const full = await fetchServer(id)
      if (gen !== _renderGen) return
      app.detailServer = full
      mount.innerHTML = renderNav('detail') +
        '<div class="stage">' + renderDetail(app.detailServer, back) + '</div>' +
        renderFooter()
    } catch {
      if (gen !== _renderGen) return
      mount.innerHTML = renderNav(back) +
        '<div class="stage"><div class="noresults">// server not found.</div></div>' +
        renderFooter()
    }

  } else if (screen === 'match') {
    mount.innerHTML = renderNav('match') +
      '<div class="stage">' +
      renderMatchScreen(app.matchResults, app.matchSubmitted, app.matchCriteria) +
      '</div>' +
      renderFooter()

  } else if (screen === 'privacy') {
    const back = params.get('back') || 'landing'
    mount.innerHTML = renderNav('privacy') +
      '<div class="stage">' + renderPrivacy(back) + '</div>' +
      renderFooter()

  } else {
    go('landing')
  }
}

// ── Event handling ────────────────────────────────────────────────────────────

document.addEventListener('click', async e => {
  const navEl = e.target.closest('[data-nav]')
  if (navEl) {
    e.preventDefault()
    const screen = navEl.dataset.nav
    if (screen === 'privacy') {
      const { screen: cur } = getRoute()
      go('privacy', { back: cur })
    } else {
      go(screen)
    }
    return
  }

  const card = e.target.closest('[data-open]')
  if (card) {
    const id = card.dataset.open
    const { screen: cur, params } = getRoute()
    go('detail', { id, back: cur === 'detail' ? (params.get('back') || 'results') : cur })
    return
  }

  const copyBtn = e.target.closest('[data-copy]')
  if (copyBtn) {
    navigator.clipboard.writeText(copyBtn.dataset.copy).then(() => {
      const orig = copyBtn.textContent
      copyBtn.textContent = 'COPIED!'
      setTimeout(() => { copyBtn.textContent = orig }, 1500)
    })
    return
  }

  const searchGoBtn = e.target.closest('[data-search-go]')
  if (searchGoBtn) {
    const searchEl = document.getElementById('search-input')
    const { params } = getRoute()
    const val = searchEl?.value.trim() || ''
    if (val) params.set('search', val)
    else params.delete('search')
    params.delete('page')
    go('results', Object.fromEntries(params))
    return
  }

  const pgBtn = e.target.closest('[data-pg]')
  if (pgBtn && !pgBtn.disabled) {
    const newPage = parseInt(pgBtn.dataset.pg, 10)
    const { params } = getRoute()
    params.set('page', newPage)
    go('results', Object.fromEntries(params))
    return
  }

  const filterBtn = e.target.closest('[data-filter]')
  if (filterBtn) {
    const field = filterBtn.dataset.filter
    const value = filterBtn.dataset.value
    if (field === 'alive') return  // handled by change event
    const { params } = getRoute()
    if (params.get(field) === value) {
      params.delete(field)
    } else {
      params.set(field, value)
    }
    params.delete('page')
    go('results', Object.fromEntries(params))
    return
  }

  if (e.target.closest('[data-reset]')) {
    go('results')
    return
  }

  const sortBtn = e.target.closest('[data-sort]')
  if (sortBtn) {
    const { params } = getRoute()
    params.set('sort', sortBtn.dataset.sort)
    params.delete('page')
    go('results', Object.fromEntries(params))
    return
  }

  if (e.target.closest('[data-land-go]')) {
    const search = document.getElementById('land-search')?.value.trim() || ''
    const region = document.getElementById('land-region')?.value || ''
    const type = document.getElementById('land-type')?.value || ''
    go('results', { search, region, type })
    return
  }

  const matchChip = e.target.closest('[data-match]')
  if (matchChip) {
    const field = matchChip.dataset.match
    const value = matchChip.dataset.value
    if (app.matchCriteria[field] === value) {
      delete app.matchCriteria[field]
    } else {
      app.matchCriteria[field] = value
    }
    app.matchSubmitted = false
    app.matchResults = null
    render()
    return
  }

  if (e.target.closest('[data-match-submit]')) {
    app.matchSubmitted = true
    app.matchResults = null
    render()
    try {
      const results = await postMatch(app.matchCriteria)
      app.matchResults = results
    } catch {
      app.matchResults = []
    }
    render()
    return
  }
})

document.addEventListener('change', e => {
  const aliveCheck = e.target.closest('[data-filter="alive"]')
  if (aliveCheck) {
    const { params } = getRoute()
    if (e.target.checked) {
      params.set('alive', '1')
    } else {
      params.delete('alive')
    }
    params.delete('page')
    go('results', Object.fromEntries(params))
  }
})

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest('#search-input')) {
    const { params } = getRoute()
    const val = e.target.value.trim()
    if (val) params.set('search', val)
    else params.delete('search')
    params.delete('page')
    go('results', Object.fromEntries(params))
  }
})

document.addEventListener('input', debounce(e => {
  const searchEl = e.target.closest('#search-input')
  if (searchEl) {
    const { params } = getRoute()
    const val = searchEl.value.trim()
    if (val) params.set('search', val)
    else params.delete('search')
    params.delete('page')
    go('results', Object.fromEntries(params))
  }
}, 400))

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('hashchange', render)
render()
