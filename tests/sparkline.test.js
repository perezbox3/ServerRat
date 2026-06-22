import { describe, it, expect } from 'vitest'
import { renderSparkline } from '../public/sparkline.js'

describe('renderSparkline', () => {
  it('returns an svg string', () => {
    const svg = renderSparkline([300, 200, 90, 30, 10])
    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('</svg>')
  })

  it('has 5 rect markers for a complete curve', () => {
    const svg = renderSparkline([300, 200, 90, 30, 10])
    expect((svg.match(/<rect/g) ?? []).length).toBe(5)
  })

  it('skips rect markers for null days', () => {
    const svg = renderSparkline([300, null, 90, null, 10])
    expect((svg.match(/<rect/g) ?? []).length).toBe(3)
  })

  it('does not throw on all-null curve', () => {
    expect(() => renderSparkline([null, null, null, null, null])).not.toThrow()
    expect(renderSparkline([null, null, null, null, null])).toMatch(/^<svg/)
  })

  it('does not throw on a single non-null value', () => {
    expect(() => renderSparkline([300, null, null, null, null])).not.toThrow()
    const svg = renderSparkline([300, null, null, null, null])
    expect((svg.match(/<rect/g) ?? []).length).toBe(1)
  })

  it('renders a gap in the line for null days — 3 line segments + 1 area path', () => {
    // [300, null, 90, null, 10] → three disconnected line segments (3 M) + 1 area fill path (1 M)
    const svg = renderSparkline([300, null, 90, null, 10])
    const mCount = (svg.match(/\bM/g) ?? []).length
    expect(mCount).toBe(4)
  })
})
