import { describe, it, expect } from 'vitest'
import { parseTitle } from '../server/parse.js'

describe('parseTitle', () => {
  it('extracts vanilla type', () => {
    expect(parseTitle('[US] Rust | Vanilla | Fridays | Max 8').type).toBe('vanilla')
  })
  it('extracts multiplier type', () => {
    expect(parseTitle('Rust 2x Weekly Duo [EU]').type).toBe('2x')
    expect(parseTitle('Lone.Design 10x Solo/Duo [Monthly]').type).toBe('10x')
  })
  it('extracts wipe day including plural forms', () => {
    expect(parseTitle('[US] Rust | Vanilla | Fridays | Max 8').wipe_day).toBe('Friday')
    expect(parseTitle('Rust | Thursday Wipe | 2x').wipe_day).toBe('Thursday')
  })
  it('extracts wipe frequency', () => {
    expect(parseTitle('Rust 2x Weekly Duo').wipe_freq).toBe('weekly')
    expect(parseTitle('Lone.Design 10x [Monthly]').wipe_freq).toBe('monthly')
    expect(parseTitle('Rust Bi-Weekly Vanilla').wipe_freq).toBe('biweekly')
  })
  it('extracts group limit from solo/duo/trio keywords', () => {
    expect(parseTitle('Rust 2x Weekly Duo [EU]').group_limit).toBe('duo')
    expect(parseTitle('Lone.Design 10x Solo/Duo [Monthly]').group_limit).toBe('duo')
    expect(parseTitle('Rust Solo/Duo/Trio | Vanilla').group_limit).toBe('trio')
    expect(parseTitle('Rust Solo Only Vanilla').group_limit).toBe('solo')
  })
  it('extracts group limit from max N pattern', () => {
    expect(parseTitle('[US] Rust | Vanilla | Fridays | Max 8').group_limit).toBe('8')
    expect(parseTitle('Rust | Max 3 | Weekly').group_limit).toBe('trio')
  })
  it('returns nulls for unrecognised names', () => {
    const r = parseTitle('Facepunch US Long 1')
    expect(r.type).toBeNull()
    expect(r.wipe_day).toBeNull()
    expect(r.wipe_freq).toBeNull()
    expect(r.group_limit).toBeNull()
  })
})
