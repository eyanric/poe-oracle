import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import { buildBaseModIndex, modRollProbability } from '../src/services/modWeightIndex'
import { estimateCraftCost } from '../src/services/craftCost'
import { searchPlans } from '../src/services/solver'
import { newItemState } from '../src/services/itemState'

// One group at 3 tiers (T1 req84, T2 req68, T3 req44) + a filler prefix, all weight 1000 on a ring.
const pre = (group: string, req: number): RepoeMod => ({
  domain: 'item', generation_type: 'prefix', name: group, type: group, is_essence_only: false, required_level: req,
  groups: [group], spawn_weights: [{ tag: 'ring', weight: 1000 }, { tag: 'default', weight: 0 }], generation_weights: [], implicit_tags: [], adds_tags: [], text: `${group} (req ${req})`,
})
const MODS: Record<string, RepoeMod> = {
  LifeT1: pre('Life', 84), LifeT2: pre('Life', 68), LifeT3: pre('Life', 44), Filler: pre('Filler', 1),
  Res: { domain: 'item', generation_type: 'suffix', name: 'Res', type: 'Res', is_essence_only: false, required_level: 1, groups: ['Res'], spawn_weights: [{ tag: 'ring', weight: 1000 }, { tag: 'default', weight: 0 }], generation_weights: [], implicit_tags: [], adds_tags: [], text: 'Res' },
}
const tags = new Set(['ring', 'default'])
const BASE: RepoeBaseItem = { name: 'Test Ring', domain: 'item', item_class: 'Ring', tags: ['ring', 'default'], release_state: 'released' }
const cur = (n: string, v: number) => ({ currencyTypeName: n, chaosEquivalent: v, receive: { value: v, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'T', fetchedAt: 0, currency: [cur('Divine Orb', 200), cur('Orb of Alteration', 0.1), cur('Regal Orb', 0.2), cur('Chaos Orb', 1), cur('Exalted Orb', 5), cur('Orb of Scouring', 1)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [], uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const deps: CraftDeps = { mods: MODS, baseItems: { r: BASE }, essences: {}, fossils: new Map(), bench: { crafts: [], meta: {} }, snapshot: SNAP, league: 'T' }

describe('tier-floor probability (modWeightIndex)', () => {
  const idx = buildBaseModIndex('Test Ring', 'Ring', tags, 84, MODS)
  it('tiers are assigned 1=best by required_level', () => {
    expect(idx.prefixes.find(e => e.modId === 'LifeT1')!.tier).toBe(1)
    expect(idx.prefixes.find(e => e.modId === 'LifeT3')!.tier).toBe(3)
  })
  it('P(group at tier ≤ floor) sums the qualifying tiers — between exact-T1 and whole-group', () => {
    const exactT1 = modRollProbability(idx, { affix: 'prefix', modId: 'LifeT1' })
    const floorT2 = modRollProbability(idx, { affix: 'prefix', group: 'Life', minTier: 2 })
    const wholeGroup = modRollProbability(idx, { affix: 'prefix', group: 'Life' })
    expect(exactT1).toBeCloseTo(1000 / 4000, 6)
    expect(floorT2).toBeCloseTo(2000 / 4000, 6) // T1 + T2
    expect(wholeGroup).toBeCloseTo(3000 / 4000, 6)
    expect(floorT2).toBeGreaterThan(exactT1)
  })
})

describe('tier-floor cost (estimateCraftCost matcher)', () => {
  const spec = (desired: { slot: 'prefix'; group?: string; modId?: string; label: string; minTier?: number }) =>
    estimateCraftCost({ baseName: 'Test Ring', ilvl: 84, desired: [desired], method: { kind: 'alt-regal' } }, deps)
  it('a T2-floor craft is materially CHEAPER than the exact-T1 craft of the same group', () => {
    const exact = spec({ slot: 'prefix', modId: 'LifeT1', label: 'T1 Life' })
    const floor = spec({ slot: 'prefix', group: 'Life', minTier: 2, label: 'Life ≥ T2' })
    expect(floor.perAttemptProb).toBeGreaterThan(exact.perAttemptProb)
    expect(floor.totalChaos!).toBeLessThan(exact.totalChaos!)
  })
})

describe('tier-floor goal test (solver)', () => {
  const ring = (over = {}) => newItemState({ base: 'Test Ring', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'], rarity: 'rare', ...over })
  const lifeFloor2 = { slot: 'prefix' as const, group: 'Life', label: 'Life ≥ T2', minTier: 2 }

  it('a present T2 (tier 2) satisfies a T2-floor target ⇒ no work needed (already met)', () => {
    const start = ring({ affixes: [{ slot: 'prefix', group: 'Life', modId: 'LifeT2', tier: 2 }] })
    const r = searchPlans({ base: 'Test Ring', ilvl: 84, start, desired: [lifeFloor2] }, deps)
    expect(r.cheapestPlan!.depth).toBe(0) // goal already satisfied
  })
  it('a present T3 (tier 3) does NOT satisfy a T2-floor ⇒ the search must still produce it', () => {
    const start = ring({ affixes: [{ slot: 'prefix', group: 'Life', modId: 'LifeT3', tier: 3 }] })
    const r = searchPlans({ base: 'Test Ring', ilvl: 84, start, desired: [lifeFloor2] }, deps)
    expect(r.cheapestPlan!.depth).toBeGreaterThan(0)
  })
  it('the good-enough-vs-perfect tradeoff: T2-floor solves cheaper than exact-T1', () => {
    const floor = searchPlans({ base: 'Test Ring', ilvl: 84, desired: [lifeFloor2] }, deps)
    const exact = searchPlans({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', modId: 'LifeT1', label: 'exact T1' }] }, deps)
    expect(floor.cheapestPlan!.rankChaos).toBeLessThan(exact.cheapestPlan!.rankChaos)
  })
})

describe('default (no floor) is unchanged', () => {
  it('a no-floor modId target probability == exact tier weight / pool', () => {
    const idx = buildBaseModIndex('Test Ring', 'Ring', tags, 84, MODS)
    expect(modRollProbability(idx, { affix: 'prefix', modId: 'LifeT1' })).toBeCloseTo(0.25, 6)
  })
})
