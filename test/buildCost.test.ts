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
  uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
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

describe('variant-matched unique pricing (build-cost-local)', () => {
  // A snapshot where each multi-variant unique lists every variant as a parenthetical in `name`,
  // priced so the WRONG pick (max) is obvious. lowConfidence marks thin/outlier variants.
  const VSNAP: EconomySnapshot = {
    league: 'Mirage', fetchedAt: Date.now(), source: 'test',
    currency: [cur('Divine Orb', 500)], fragments: [], essences: [], divCards: [],
    uniqueWeapons: [], uniqueArmours: [], uniqueFlasks: [], skillGems: [], maps: [], scarabs: [], oils: [],
    uniqueAccessories: [
      { name: 'Screams of the Desiccated (Echoing)', baseType: 'belt', chaosValue: 50000, divineValue: 100, listingCount: 20, source: 'test' },
      { name: 'Screams of the Desiccated (Acceleration, Impenetrable)', baseType: 'belt', chaosValue: 3000, divineValue: 6, listingCount: 8, source: 'test' },
    ],
    uniqueJewels: [
      { name: 'Voices (1 passives)', baseType: 'jewel', chaosValue: 100000, divineValue: 200, listingCount: 30, source: 'test' },
      { name: 'Voices (3 passives)', baseType: 'jewel', chaosValue: 200, divineValue: 0.4, listingCount: 40, source: 'test' },
      { name: 'Thread of Hope (Very Large)', baseType: 'jewel', chaosValue: 5000, divineValue: 10, listingCount: 70, source: 'test' },
      { name: 'Thread of Hope (Large)', baseType: 'jewel', chaosValue: 900, divineValue: 1.8, listingCount: 70, source: 'test' },
      { name: 'Forbidden Flesh (Avatar of the Wilds)', baseType: 'jewel', chaosValue: 100, divineValue: 0.2, listingCount: 12, source: 'test' },
    ],
  }
  const vdeps: BuildCostDeps = { snapshot: VSNAP, league: 'Mirage', today: '2026-06-17' }
  const price = (name: string, mods: string[]) =>
    estimateBuildCost([{ slot: 's', name, category: 'unique', mods }], vdeps).pieces[0]

  it('(a) picks the variant the build runs — Thread of Hope radius, not the priciest', () => {
    const p = price('Thread of Hope', ['Only affects Passives in Large Ring', '-17% to all Elemental Resistances'])
    expect(p.variant).toBe('Large')
    expect(p.chaos).toBe(900) // not the 5000 (Very Large) max
  })
  it('(b) an absent variant is unpriced + flagged, never substituted', () => {
    const p = price('Forbidden Flesh', ['Allocates Unleashed Potential if you have the matching modifier on Forbidden Flame', 'Corrupted'])
    expect(p.chaos).toBeNull()
    expect(p.lowConfidence).toBe(true)
    expect(p.note).toMatch(/unleashed potential.*not listed/i)
  })
  it('(c) Screams two-token shrine-buff label matched UNORDERED', () => {
    const p = price('Screams of the Desiccated', ['You have Impenetrable Shrine Buff while affected by no Flasks', 'You have Acceleration Shrine Buff while affected by no Flasks'])
    expect(p.variant).toBe('Acceleration, Impenetrable')
    expect(p.chaos).toBe(3000) // not the 50000 (Echoing) max; matched despite reversed mod order
  })
  it('(d) Voices numeric label matched (not string-equal)', () => {
    const p = price('Voices', ['Adds 3 Jewel Socket Passive Skills', 'Adds 1 Small Passive Skill which grants nothing'])
    expect(p.variant).toBe('3 passives')
    expect(p.chaos).toBe(200) // not the 100000 (1 passives) max
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
