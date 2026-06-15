import { describe, it, expect, beforeEach } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import { resolveTargets, classifyMod, clearModProducerCache } from '../src/services/modProducer'
import { searchPlans } from '../src/services/solver'
import { clearModWeightIndexCache } from '../src/services/modWeightIndex'

// A stat that exists as BOTH a normal explicit AND an eldritch implicit (the conflation case),
// plus single-domain mods, on a gloves base (gloves is eldritch-eligible + influence-eligible).
const m = (over: Partial<RepoeMod> & Pick<RepoeMod, 'domain' | 'generation_type' | 'groups'>): RepoeMod => ({
  name: over.groups[0], type: over.groups[0], is_essence_only: false, required_level: 1, text: over.text ?? over.groups[0],
  spawn_weights: [], generation_weights: [], implicit_tags: [], adds_tags: [], ...over,
})
const MODS: Record<string, RepoeMod> = {
  // "Shared" stat in two domains — different modIds, different slots/identities.
  SharedExp: m({ domain: 'item', generation_type: 'prefix', groups: ['SharedMS'], text: '25% increased Movement Speed', spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  SharedEld: m({ domain: 'item', generation_type: 'searing_exarch_implicit', groups: ['SharedMS'], text: '10% increased Movement Speed', spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  // two explicit tiers of one stat (ambiguous-by-tier)
  LifeT1: m({ domain: 'item', generation_type: 'prefix', groups: ['Life'], text: '+100 to maximum Life', spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }], required_level: 84 }),
  LifeT2: m({ domain: 'item', generation_type: 'prefix', groups: ['Life'], text: '+80 to maximum Life', spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }], required_level: 60 }),
  // two resistance groups (a pseudo "Resistance" spans both)
  FireRes: m({ domain: 'item', generation_type: 'suffix', groups: ['FireResistance'], text: '+40% to Fire Resistance', spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  ColdRes: m({ domain: 'item', generation_type: 'suffix', groups: ['ColdResistance'], text: '+40% to Cold Resistance', spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }] }),
}
const BASE: RepoeBaseItem = { name: 'Test Gloves', domain: 'item', item_class: 'Gloves', tags: ['gloves', 'int_armour', 'armour', 'default'], release_state: 'released' }
const cur = (n: string, v: number) => ({ currencyTypeName: n, chaosEquivalent: v, receive: { value: v, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'T', fetchedAt: 0, currency: [cur('Divine Orb', 200), cur('Orb of Alteration', 0.1), cur('Regal Orb', 0.2), cur('Chaos Orb', 1), cur('Exalted Orb', 5), cur('Orb of Scouring', 1), cur('Exceptional Eldritch Ember', 400)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [], uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const deps: CraftDeps = { mods: MODS, baseItems: { g: BASE }, essences: {}, fossils: new Map(), bench: { crafts: [], meta: {} }, snapshot: SNAP, league: 'T' }
beforeEach(() => { clearModProducerCache(); clearModWeightIndexCache() })

describe('resolveTargets — stat/group → candidate modIds', () => {
  it('ambiguous stat returns MULTIPLE candidates across domains (explicit + eldritch)', () => {
    const cands = resolveTargets('increased Movement Speed', BASE, 84, MODS)
    const byDomain = new Set(cands.map(c => c.domain))
    expect(cands.map(c => c.modId).sort()).toEqual(['SharedEld', 'SharedExp'])
    expect(byDomain).toEqual(new Set(['explicit', 'eldritch-implicit']))
  })
  it('ambiguous-by-tier: a stat with multiple tiers returns each tier as a distinct modId', () => {
    const cands = resolveTargets('maximum Life', BASE, 84, MODS)
    expect(cands.map(c => c.modId).sort()).toEqual(['LifeT1', 'LifeT2'])
    expect(new Set(cands.map(c => c.tier)).size).toBe(2)
  })
  it('pseudo/aggregate: "Resistance" spans several contributing modIds/groups', () => {
    const cands = resolveTargets('Resistance', BASE, 84, MODS)
    expect(cands.map(c => c.modId).sort()).toEqual(['ColdRes', 'FireRes'])
    expect(new Set(cands.map(c => c.group)).size).toBe(2)
  })
})

describe('modId targeting removes cross-domain conflation', () => {
  it('the eldritch-implicit modId classifies eldritch; the same-stat explicit modId classifies core', () => {
    expect([...classifyMod({ slot: 'prefix', modId: 'SharedEld' }, BASE, 84, MODS).classes]).toEqual(['eldritch'])
    expect([...classifyMod({ slot: 'prefix', modId: 'SharedExp' }, BASE, 84, MODS).classes]).toEqual(['core'])
  })
  it('targeting the eldritch modId routes eldritch (not the same-stat explicit)', () => {
    const r = searchPlans({ base: 'Test Gloves', ilvl: 84, desired: [{ slot: 'prefix', modId: 'SharedEld', label: 'eldritch MS' }] }, deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.moves.some(mv => /eldritch/i.test(mv.label))).toBe(true)
  })
  it('targeting the explicit modId routes core/explicit (never eldritch)', () => {
    const r = searchPlans({ base: 'Test Gloves', ilvl: 84, desired: [{ slot: 'prefix', modId: 'SharedExp', label: 'explicit MS' }] }, deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.moves.every(mv => !/eldritch/i.test(mv.label))).toBe(true)
  })
  it('goal test keys on the exact modId — a same-stat sibling does not satisfy it', () => {
    // an item that has the EXPLICIT shared mod present does NOT satisfy an ELDRITCH-modId target
    const r = searchPlans({ base: 'Test Gloves', ilvl: 84, desired: [{ slot: 'prefix', modId: 'SharedEld', label: 'eldritch MS' }] }, deps)
    // the cheapest plan's producing move is the eldritch implicit, not an explicit roll of the sibling
    expect(r.cheapestPlan!.moves.some(mv => /eldritch/i.test(mv.label))).toBe(true)
  })
})
