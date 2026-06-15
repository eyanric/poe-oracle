import { describe, it, expect } from 'vitest'
import type { RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import { classifyMod } from '../src/services/modProducer'
import { searchPlans } from '../src/services/solver'
import { newItemState, withAnoint, stateKey, openSlots } from '../src/services/itemState'
import { ANOINT_RECIPES } from '../src/data/anointRecipes'

const AMULET: RepoeBaseItem = { name: 'Onyx Amulet', domain: 'item', item_class: 'Amulet', tags: ['amulet', 'default'], release_state: 'released' }
const RING: RepoeBaseItem = { name: 'Iron Ring', domain: 'item', item_class: 'Ring', tags: ['ring', 'default'], release_state: 'released' }
const cur = (n: string, v: number) => ({ currencyTypeName: n, chaosEquivalent: v, receive: { value: v, listing_count: 50 } })
const oil = (n: string, v: number) => ({ name: n, baseType: n, chaosValue: v, divineValue: v / 200, listingCount: 50, source: 'test' as const })
const SNAP: EconomySnapshot = {
  league: 'T', fetchedAt: 0, currency: [cur('Divine Orb', 200), cur('Chaos Orb', 1)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [], uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [],
  oils: [oil('Golden Oil', 300), oil('Clear Oil', 1)],
}
const deps: CraftDeps = { mods: {}, baseItems: { a: AMULET, r: RING }, essences: {}, fossils: new Map(), bench: { crafts: [], meta: {} }, snapshot: SNAP, league: 'T' }
const NOTABLE = 'Whispers of Doom' // the committed seed entry (3 Golden)
const anointTarget = { slot: 'prefix' as const, modId: NOTABLE, label: NOTABLE, anoint: true }

describe('anoint producer — classifyMod', () => {
  it('an anointable notable on an amulet → the anoint producer with its fixed recipe', () => {
    const c = classifyMod(anointTarget, AMULET, 84, {})
    expect(c.classes.has('anoint')).toBe(true)
    expect(c.specs).toEqual([{ kind: 'anoint', notable: NOTABLE }])
    expect(ANOINT_RECIPES[NOTABLE]).toEqual(['Golden', 'Golden', 'Golden'])
  })
  it('a notable NOT in the table → no anoint candidate (no false positive)', () => {
    const c = classifyMod({ slot: 'prefix', modId: 'Not A Real Anoint', label: 'x', anoint: true }, AMULET, 84, {})
    expect(c.classes.has('anoint')).toBe(false)
    expect(c.specs).toEqual([])
  })
  it('an amulet base is required — the same notable on a ring yields no anoint candidate', () => {
    const c = classifyMod(anointTarget, RING, 84, {})
    expect(c.classes.has('anoint')).toBe(false)
  })
})

describe('anoint producer — enchant slot model', () => {
  const bare = newItemState({ base: 'Onyx Amulet', itemClass: 'Amulet', ilvl: 84, tags: ['amulet', 'default'], rarity: 'rare' })
  it('withAnoint sets the enchant slot without touching affix capacity', () => {
    const a = withAnoint(bare, NOTABLE)
    expect(a.anoint).toBe(NOTABLE)
    expect(a.affixes).toEqual(bare.affixes)
    expect(openSlots(a, 'prefix')).toBe(openSlots(bare, 'prefix'))
    expect(openSlots(a, 'suffix')).toBe(openSlots(bare, 'suffix'))
  })
  it('the anoint is part of the canonical state key', () => {
    expect(stateKey(withAnoint(bare, NOTABLE))).not.toBe(stateKey(bare))
  })
})

describe('anoint producer — solver', () => {
  it('an anointable notable solves deterministically (depth 1, anoint move, 3 oils priced live)', () => {
    const r = searchPlans({ base: 'Onyx Amulet', ilvl: 84, desired: [anointTarget] }, deps)
    const p = r.cheapestPlan!
    expect(p.depth).toBe(1)
    expect(p.moves.some(m => /anoint/i.test(m.label))).toBe(true)
    expect(p.expectedChaos).toBeCloseTo(900, 6) // 3 × 300c Golden Oil
    expect(p.p90).toBeCloseTo(p.expectedChaos!, 6) // deterministic ⇒ no spread
  })
  it('a present anoint already satisfies the target ⇒ depth 0 (no work)', () => {
    const start = withAnoint(newItemState({ base: 'Onyx Amulet', itemClass: 'Amulet', ilvl: 84, tags: ['amulet', 'default'], rarity: 'rare' }), NOTABLE)
    const r = searchPlans({ base: 'Onyx Amulet', ilvl: 84, start, desired: [anointTarget] }, deps)
    expect(r.cheapestPlan!.depth).toBe(0)
  })
  it('a non-anointable notable yields no plan (not guessed)', () => {
    const r = searchPlans({ base: 'Onyx Amulet', ilvl: 84, desired: [{ slot: 'prefix', modId: 'Not A Real Anoint', label: 'x', anoint: true }] }, deps)
    expect(r.plans).toHaveLength(0)
  })
})
