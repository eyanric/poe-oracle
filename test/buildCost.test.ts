import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { estimateBuildCost, classifyTier, gearListFromPob, type GearPiece, type BuildCostDeps } from '../src/services/buildCost'
import { parsePobCode } from '../src/services/pobParser'
import type { EconomySnapshot, ItemPrice, CurrencyPrice } from '../src/services/economyTypes'

const cur = (name: string, chaos: number): CurrencyPrice => ({ currencyTypeName: name, chaosEquivalent: chaos, receive: { value: chaos, listing_count: 99 }, source: 'test' })
const uniq = (name: string, chaos: number, divine: number, listings = 50): ItemPrice => ({ name, baseType: name, chaosValue: chaos, divineValue: divine, listingCount: listings, source: 'test' })

const SNAPSHOT: EconomySnapshot = {
  league: 'Mirage', fetchedAt: Date.now(), source: 'test',
  currency: [cur('Divine Orb', 500)], fragments: [],
  essences: [], divCards: [],
  uniqueWeapons: [uniq('Tabula Rasa', 150, 0.3)],
  uniqueArmours: [uniq('Belly of the Beast', 200, 0.4)],
  uniqueAccessories: [uniq('Headhunter', 80000, 160)],
  uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [],
}
const deps: BuildCostDeps = { snapshot: SNAPSHOT, league: 'Mirage', today: '2026-06-14' }

describe('classifyTier', () => {
  it('buckets by divine thresholds', () => {
    expect(classifyTier(5)).toBe('starter')
    expect(classifyTier(50)).toBe('functional')
    expect(classifyTier(500)).toBe('aspirational')
    expect(classifyTier(null)).toBe('unknown')
  })
})

describe('estimateBuildCost', () => {
  it('prices a starter build and totals in chaos + divine', () => {
    const items: GearPiece[] = [
      { slot: 'Body Armour', name: 'Tabula Rasa', category: 'unique' },
      { slot: 'Chest', name: 'Belly of the Beast', category: 'unique' },
    ]
    const r = estimateBuildCost(items, deps)
    expect(r.totalChaos).toBeCloseTo(350, 6)
    expect(r.totalDivine).toBeCloseTo(350 / 500, 6)
    expect(r.tier).toBe('starter')
    expect(r.unpricedSlots).toHaveLength(0)
  })

  it('flags unpriced (rare) slots and treats the total as a lower bound', () => {
    const items: GearPiece[] = [
      { slot: 'Body Armour', name: 'Tabula Rasa', category: 'unique' },
      { slot: 'Ring', name: 'Some Crafted Rare Ring', category: 'unique' },
    ]
    const r = estimateBuildCost(items, deps)
    expect(r.unpricedSlots).toEqual(['Ring'])
    expect(r.lowConfidence).toBe(true)
    expect(r.notes.join(' ')).toMatch(/LOWER BOUND/)
  })

  it('classifies an aspirational build', () => {
    const items: GearPiece[] = [{ slot: 'Belt', name: 'Headhunter', category: 'unique' }]
    const r = estimateBuildCost(items, deps)
    expect(r.tier).toBe('aspirational')
    expect(r.totalDivine).toBeCloseTo(160, 1)
  })

  it('respects quantity', () => {
    const r = estimateBuildCost([{ slot: 'Body Armour', name: 'Tabula Rasa', category: 'unique', qty: 2 }], deps)
    expect(r.totalChaos).toBeCloseTo(300, 6)
  })
})

describe('gearListFromPob → build cost (Phase 3 integration)', () => {
  const endgame = parsePobCode(
    readFileSync(fileURLToPath(new URL('./fixtures/pob-endgame.txt', import.meta.url)), 'utf8'),
  )

  it('converts a parsed PoB into a priceable gear list', () => {
    const gear = gearListFromPob(endgame)
    expect(gear.find(g => g.slot === 'Body Armour')).toMatchObject({ name: 'Belly of the Beast', category: 'unique' })
    expect(gear.find(g => g.slot === 'Belt')).toMatchObject({ name: 'Headhunter', category: 'unique' })
    // the rare ring falls through to its base type (will be unpriced, as expected)
    expect(gear.find(g => g.slot === 'Ring 1')?.category).toBeUndefined()
  })

  it('a parsed export produces a cost estimate (uniques priced, rares flagged)', () => {
    const r = estimateBuildCost(gearListFromPob(endgame), deps)
    expect(r.totalChaos).toBeGreaterThan(0)
    expect(r.pieces.find(p => p.name === 'Belly of the Beast')!.chaos).toBe(200)
    expect(r.pieces.find(p => p.name === 'Headhunter')!.chaos).toBe(80000)
    expect(r.unpricedSlots).toContain('Ring 1') // rare ring not indexed
    expect(r.tier).toBe('aspirational')
    expect(r.lowConfidence).toBe(true) // unpriced rare → lower bound
  })
})
