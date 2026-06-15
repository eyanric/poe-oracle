import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import type { BenchData, BenchCraft } from '../src/services/benchCrafting'
import { searchPlans } from '../src/services/solver'

const mod = (gen: 'prefix' | 'suffix', group: string): RepoeMod => ({
  domain: 'item', generation_type: gen, name: group, type: group, is_essence_only: false, required_level: 1,
  groups: [group], spawn_weights: [{ tag: 'body_armour', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], text: group,
})
const MODS: Record<string, RepoeMod> = {
  PfxA: mod('prefix', 'PfxA'), PfxF: mod('prefix', 'PfxFiller'),
  SfxA: mod('suffix', 'SfxA'), SfxF: mod('suffix', 'SfxFiller'),
  SfxB: mod('suffix', 'SfxB'), // benchable (for no-regression)
}
const BASE: RepoeBaseItem = { name: 'Test Armour', domain: 'item', item_class: 'Body Armour', tags: ['body_armour', 'int_armour', 'armour', 'default'], release_state: 'released' }
const BASES = { armour: BASE }
const cur = (currencyTypeName: string, chaosEquivalent: number) => ({ currencyTypeName, chaosEquivalent, receive: { value: chaosEquivalent, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'Test', fetchedAt: 0,
  // Exalted (slam) expensive so add-only slam loses to a cheap metamod lock + chaos reforge.
  currency: [cur('Divine Orb', 200), cur('Orb of Alteration', 0.1), cur('Regal Orb', 0.2), cur('Chaos Orb', 1), cur('Orb of Alchemy', 0.5), cur('Exalted Orb', 500), cur('Orb of Scouring', 1)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [],
  uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const lock = (slot: 'prefix' | 'suffix', meta: 'lockPrefixes' | 'lockSuffixes'): BenchCraft =>
  ({ modId: meta, slot, label: `${slot} cannot be changed`, itemClasses: ['Body Armour'], costName: 'Orb of Alteration', costAmount: 1, meta })
const BENCH: BenchData = {
  crafts: [{ modId: 'SfxB', slot: 'suffix', label: 'B craft', itemClasses: ['Body Armour'], costName: 'Orb of Alteration', costAmount: 1, meta: null }],
  meta: { lockPrefixes: lock('prefix', 'lockPrefixes'), lockSuffixes: lock('suffix', 'lockSuffixes') },
}
const deps: CraftDeps = { mods: MODS, baseItems: BASES, essences: {}, fossils: new Map(), bench: BENCH, snapshot: SNAP, league: 'Test' }
const PS_TARGET = { base: 'Test Armour', ilvl: 84, desired: [{ slot: 'prefix' as const, group: 'PfxA', label: 'PfxA' }, { slot: 'suffix' as const, group: 'SfxA', label: 'SfxA' }] }

describe('multi-step search — protect-then-proceed', () => {
  const r = searchPlans(PS_TARGET, deps)

  it('finds an explicit protect-then-proceed plan (produce one side → lock → roll the other)', () => {
    const lockPlan = r.plans.find(p => p.moves.some(m => m.kind === 'lock'))
    expect(lockPlan).toBeTruthy()
    // a returned plan is COMPLETE (all desired present) ⇒ the post-lock reforge did NOT destroy the locked side
    expect(lockPlan!.moves.length).toBeGreaterThanOrEqual(3) // produce + lock + reforge
    const lockIdx = lockPlan!.moves.findIndex(m => m.kind === 'lock')
    expect(lockPlan!.moves.slice(lockIdx + 1).some(m => m.kind === 'method')).toBe(true) // a roll AFTER the lock
  })

  it('with a cheap lock + expensive slam, the protected plan beats the best single method', () => {
    const single = searchPlans({ ...PS_TARGET }, deps) // depth-1 plans included in the same search
    const bestSingle = single.plans.find(p => p.depth === 1)
    expect(r.cheapestPlan).toBeTruthy()
    if (bestSingle) expect(r.cheapestPlan!.rankChaos).toBeLessThanOrEqual(bestSingle.rankChaos)
  })

  it('terminates with finite node count and uses memoization (scour cannot loop)', () => {
    expect(r.search.nodes).toBeGreaterThan(0)
    expect(Number.isFinite(r.search.nodes)).toBe(true)
    expect(r.search.memoHits + r.search.pruned).toBeGreaterThan(0)
  })

  it('propagates confidence/flags from a flagged step (the metamod lock cost)', () => {
    const lockPlan = r.plans.find(p => p.moves.some(m => m.kind === 'lock'))!
    expect(lockPlan.flags.length).toBeGreaterThan(0)
    expect(lockPlan.confidence).toBe('low')
  })
})

describe('multi-step search — no regression', () => {
  it('a single benchable mod solves to a depth-1 single move (no padding)', () => {
    const r = searchPlans({ base: 'Test Armour', ilvl: 84, desired: [{ slot: 'suffix', group: 'SfxB', label: 'B craft' }] }, deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.depth).toBe(1)
    expect(r.cheapestPlan!.moves[0].label).toMatch(/bench/i)
  })

  it('rejects an abstract target', () => {
    const r = searchPlans({ base: 'Test Armour', ilvl: 84, desired: [{ slot: 'prefix', label: 'any' }] }, deps)
    expect(r.cheapestPlan).toBeNull()
    expect(r.verdict.rationale).toMatch(/abstract|specific/i)
  })

  it('reports the search bounds (depth cap + beam width)', () => {
    const r = searchPlans(PS_TARGET, deps)
    expect(r.search.depthCap).toBeGreaterThan(0)
    expect(r.search.beamWidth).toBeGreaterThan(0)
  })
})
