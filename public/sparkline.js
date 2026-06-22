const DAYS = [1, 2, 3, 5, 7]

export function renderSparkline(curve, { id = 'spk', w = 168, h = 46, strong = false } = {}) {
  const pad = 3
  const xs = DAYS.map(d => pad + ((d - 1) / 6) * (w - pad * 2))
  const nonNull = (curve ?? []).filter(v => v != null)

  if (nonNull.length === 0) {
    return `<svg class="spk" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"></svg>`
  }

  const ceil = Math.max(...nonNull)
  const ys = (curve ?? []).map(v => v == null ? null : pad + (1 - v / ceil) * (h - pad * 2))

  // Line path — start a new M segment after each null gap
  const lineParts = []
  let inSeg = false
  for (let i = 0; i < 5; i++) {
    if (ys[i] == null) { inSeg = false; continue }
    lineParts.push((inSeg ? 'L' : 'M') + xs[i].toFixed(1) + ' ' + ys[i].toFixed(1))
    inSeg = true
  }
  const line = lineParts.join(' ')

  // Area fill — connect non-null points in order, close at bottom
  const pts = xs.map((x, i) => ys[i] != null ? [x, ys[i]] : null).filter(Boolean)
  let area = ''
  if (pts.length >= 2) {
    const p = pts.map((pt, i) => (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ')
    area = `${p} L${pts.at(-1)[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`
  }

  const col = strong ? 'var(--pop)' : 'var(--rust)'
  const gid = 'spk-' + id

  const rects = (curve ?? []).map((v, i) => {
    if (v == null) return ''
    return `<rect x="${(xs[i] - 3.5).toFixed(1)}" y="${(ys[i] - 3.5).toFixed(1)}" width="7" height="7" fill="${col}" stroke="var(--edge)" stroke-width="1.5"/>`
  }).join('')

  return `<svg class="spk" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" shape-rendering="crispEdges">` +
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${col}" stop-opacity="0.30"/>` +
    `<stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>` +
    `<line x1="0" x2="${w}" y1="${h * 0.5}" y2="${h * 0.5}" class="spk-grid"/>` +
    (area ? `<path d="${area}" fill="url(#${gid})"/>` : '') +
    (line ? `<path d="${line}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="miter" stroke-linecap="butt"/>` : '') +
    rects +
    `</svg>`
}
