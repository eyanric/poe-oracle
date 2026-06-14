import { describe, it, expect } from 'vitest'
import { estimateBuildCost, classifyTier, type GearPiece, type BuildCostDeps } from '../src/services/buildCost'
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
