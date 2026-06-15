import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import type { BenchData, BenchCraft } from '../src/services/benchCrafting'
import { planExpectedCost, simulatePlanCost, searchPlans, type PlanMove } from '../src/services/solver'

const mv = (over: Partial<PlanMove>): PlanMove => ({
  kind: 'method', label: 'x', chaos: 0, p90: 0, perAttemptProb: 1, confidence: 'high', flags: [],
  effect: 'additive', respectsLocks: true, ...over,
})
const P = [{ slot: 'prefix' as const, group: 'P', label: 'P' }]
const S = [{ slot: 'suffix' as const, group: 'S', label: 'S' }]
const produceP = mv({ label: 'produce P', chaos: 10, produces: P })
const lockPre = mv({ kind: 'lock', label: 'lock prefixes', chaos: 400, effect: 'protective', slot: 'prefix' })

describe('planExpectedCost — reproduction term', () => {
  it('protected plan: reforge respects the lock ⇒ NO reproduction (Σ only) — no regression', () => {
    const moves = [produceP, lockPre, mv({ label: 'reforge S', chaos: 20, perAttemptProb: 0.5, effect: 'destructive', respectsLocks: true, produces: S })]
    expect(planExpectedCost(moves)).toBe(10 + 400 + 20)
  })
  it('respectsLocks honoured: a LOCK-IGNORING destructive (Awakener\'s / Dominance) after the lock DOES reproduce the locked mod', () => {
    const moves = [produceP, lockPre, mv({ label: 'Orb of Dominance', chaos: 20, perAttemptProb: 0.5, effect: 'destructive', respectsLocks: false, produces: S })]
    expect(planExpectedCost(moves)).toBe(10 + 400 + 20 + 10) // +10 = reproduce P (lock ignored)
  })
  it('unprotected: a destructive step over an unlocked secured mod reproduces it', () => {
    const moves = [produceP, mv({ label: 'reforge S', chaos: 20, perAttemptProb: 0.5, effect: 'destructive', respectsLocks: true, produces: S })]
    expect(planExpectedCost(moves)).toBe(10 + 20 + 10) // P unlocked ⇒ reproduced
  })
  it('only destroyed mods are reproduced: an ADDITIVE step destroys nothing', () => {
    const moves = [produceP, mv({ label: 'add S', chaos: 5, effect: 'additive', produces: S })]
    expect(planExpectedCost(moves)).toBe(15)
  })
  it('reproduction scales with the number/cost of destroyed secured mods', () => {
    const produceP2 = mv({ label: 'produce P2', chaos: 7, produces: [{ slot: 'prefix', group: 'P2', label: 'P2' }] })
    const moves = [produceP, produceP2, mv({ label: 'reforge S', chaos: 20, perAttemptProb: 0.5, effect: 'destructive', respectsLocks: true, produces: S })]
    expect(planExpectedCost(moves)).toBe(10 + 7 + 20 + 10 + 7) // both prefixes reproduced
  })
  it('uses the supplied cost selector (p90 basis)', () => {
    const moves = [mv({ label: 'P', chaos: 10, p90: 18, produces: P }), mv({ label: 'reforge S', chaos: 20, p90: 40, perAttemptProb: 0.5, effect: 'destructive', respectsLocks: true, produces: S })]
    expect(planExpectedCost(moves, m => m.p90 ?? 0)).toBe(18 + 40 + 18)
  })
})

describe('simulatePlanCost — closed-form ≈ Monte-Carlo', () => {
  const cases: PlanMove[][] = [
    [produceP, lockPre, mv({ label: 'reforge S', chaos: 20, perAttemptProb: 0.5, effect: 'destructive', respectsLocks: true, produces: S })],
    [produceP, mv({ label: 'reforge S', chaos: 30, perAttemptProb: 0.3, effect: 'destructive', respectsLocks: false, produces: S })],
    [produceP, produceP, mv({ label: 'reforge S', chaos: 12, perAttemptProb: 0.6, effect: 'destructive', respectsLocks: true, produces: S })],
  ]
  it('MC mean is within 4% of the closed form on each case', () => {
    for (const moves of cases) {
      const closed = planExpectedCost(moves)
      const mc = simulatePlanCost(moves, 40000)
      expect(Math.abs(mc - closed) / closed).toBeLessThan(0.04)
    }
  })
})

// ── search-level: the cost model is used + no regression on protected plans ──────
const m = (gen: 'prefix' | 'suffix', group: string): RepoeMod => ({
  domain: 'item', generation_type: gen, name: group, type: group, is_essence_only: false, required_level: 1,
  groups: [group], spawn_weights: [{ tag: 'ring', weight: 1000 }, { tag: 'default', weight: 0 }], generation_weights: [], implicit_tags: [], adds_tags: [], text: group,
})
const MODS: Record<string, RepoeMod> = { L: m('prefix', 'PfxLife'), R: m('suffix', 'SfxRes') }
const BASE: RepoeBaseItem = { name: 'Test Ring', domain: 'item', item_class: 'Ring', tags: ['ring', 'default'], release_state: 'released' }
const cur = (n: string, v: number) => ({ currencyTypeName: n, chaosEquivalent: v, receive: { value: v, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'T', fetchedAt: 0, currency: [cur('Divine Orb', 200), cur('Orb of Alteration', 0.1), cur('Regal Orb', 0.2), cur('Chaos Orb', 1), cur('Exalted Orb', 5), cur('Orb of Scouring', 1)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [], uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const lock = (slot: 'prefix' | 'suffix', meta: 'lockPrefixes' | 'lockSuffixes'): BenchCraft => ({ modId: meta, slot, label: `${slot} cannot be changed`, itemClasses: ['Ring'], costName: 'Orb of Alteration', costAmount: 1, meta })
const BENCH: BenchData = { crafts: [], meta: { lockPrefixes: lock('prefix', 'lockPrefixes'), lockSuffixes: lock('suffix', 'lockSuffixes') } }
const deps: CraftDeps = { mods: MODS, baseItems: { r: BASE }, essences: {}, fossils: new Map(), bench: BENCH, snapshot: SNAP, league: 'T' }

describe('searchPlans uses the reproduction cost model', () => {
  it('a returned plan’s expectedChaos equals planExpectedCost of its moves', () => {
    const r = searchPlans({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', group: 'PfxLife', label: 'L' }, { slot: 'suffix', group: 'SfxRes', label: 'R' }] }, deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.expectedChaos).toBeCloseTo(planExpectedCost(r.cheapestPlan!.moves, mm => mm.chaos ?? 0), 6)
  })
  it('no regression: a single-mod target still solves to a depth-1 plan', () => {
    const r = searchPlans({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', group: 'PfxLife', label: 'L' }] }, deps)
    expect(r.cheapestPlan!.depth).toBe(1)
  })
})
