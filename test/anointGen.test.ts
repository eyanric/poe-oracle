import { describe, it, expect } from 'vitest'
import { OIL_TIERS, ANOINT_ONLY_OILS, ANOINT_RECIPES, isAnointableNotable } from '../src/data/anointRecipes'

// Invariants the generator (scripts/gen-anoints.mjs) guarantees about data/anointRecipes.ts.
// A regenerate that breaks any of these should fail CI before it's committed.
const ALL_OILS: readonly string[] = [...OIL_TIERS, ...ANOINT_ONLY_OILS]
const VALID = new Set<string>(ALL_OILS)
const order = (o: string): number => ALL_OILS.indexOf(o)

describe('anoint recipe table (generated from poewiki Cargo)', () => {
  it('anchor: Whispers of Doom → 3× Golden (round-trips the known recipe)', () => {
    expect(ANOINT_RECIPES['Whispers of Doom']).toEqual(['Golden', 'Golden', 'Golden'])
  })

  it('count is a few hundred amulet recipes (not 1, not 5000)', () => {
    const n = Object.keys(ANOINT_RECIPES).length
    expect(n).toBeGreaterThan(200)
    expect(n).toBeLessThan(1000)
  })

  it('OIL_TIERS stays the 13 standard; Prismatic is the anoint-only exclusive', () => {
    expect(OIL_TIERS).toHaveLength(13)
    expect(OIL_TIERS[0]).toBe('Clear')
    expect(OIL_TIERS[12]).toBe('Golden')
    expect(ANOINT_ONLY_OILS).toEqual(['Prismatic'])
  })

  it('every recipe is exactly 3 valid oils, stored in canonical (tier) order', () => {
    for (const [notable, oils] of Object.entries(ANOINT_RECIPES)) {
      expect(oils, notable).toHaveLength(3)
      for (const o of oils) expect(VALID.has(o), `${notable}: ${o}`).toBe(true)
      const sorted = [...oils].sort((a, b) => order(a) - order(b))
      expect(oils, `${notable} not canonical`).toEqual(sorted)
    }
  })

  it('generic +30 attribute anoints are absent (removed in 3.25 — correctly missing)', () => {
    expect(isAnointableNotable('Strength')).toBe(false)
    expect(isAnointableNotable('Dexterity')).toBe(false)
    expect(isAnointableNotable('Intelligence')).toBe(false)
  })

  it('isAnointableNotable: seeded notable true, unknown false', () => {
    expect(isAnointableNotable('Whispers of Doom')).toBe(true)
    expect(isAnointableNotable('Not A Real Notable')).toBe(false)
  })
})
