import { describe, it, expect, beforeEach } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import { classifyMod, modProducers, clearModProducerCache } from '../src/services/modProducer'
import { searchPlans } from '../src/services/solver'
import { clearModWeightIndexCache } from '../src/services/modWeightIndex'

// Synthetic mods, each EXCLUSIVE to one class (no group conflation) on a gloves base.
const m = (over: Partial<RepoeMod> & Pick<RepoeMod, 'domain' | 'generation_type' | 'groups'>): RepoeMod => ({
  name: over.groups[0], type: over.groups[0], is_essence_only: false, required_level: 1, text: over.groups[0],
  spawn_weights: [], generation_weights: [], implicit_tags: [], adds_tags: [], ...over,
})
const MODS: Record<string, RepoeMod> = {
  // influence-only suffix (gated by gloves_shaper; weight 0 on the bare base ⇒ not a plain explicit)
  InfSuf: m({ domain: 'item', generation_type: 'suffix', groups: ['InfOnly'], spawn_weights: [{ tag: 'gloves_shaper', weight: 800 }, { tag: 'default', weight: 0 }] }),
  // eldritch-exclusive implicit (Exarch) — separate generation_type, not a prefix/suffix
  Eld: m({ domain: 'item', generation_type: 'searing_exarch_implicit', groups: ['EldOnly'], spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  // veiled-exclusive (unveiled domain)
  Veil: m({ domain: 'unveiled', generation_type: 'prefix', groups: ['VeilOnly'], spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  // plain explicit prefix (core)
  Plain: m({ domain: 'item', generation_type: 'prefix', groups: ['PlainPfx'], spawn_weights: [{ tag: 'gloves', weight: 1000 }, { tag: 'default', weight: 0 }] }),
}
const BASE: RepoeBaseItem = { name: 'Test Gloves', domain: 'item', item_class: 'Gloves', tags: ['gloves', 'int_armour', 'armour', 'default'], release_state: 'released' }
const cur = (currencyTypeName: string, chaosEquivalent: number) => ({ currencyTypeName, chaosEquivalent, receive: { value: chaosEquivalent, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'Test', fetchedAt: 0,
  currency: [cur('Divine Orb', 200), cur('Orb of Alteration', 0.1), cur('Regal Orb', 0.2), cur('Chaos Orb', 1), cur('Exalted Orb', 5), cur('Orb of Alchemy', 0.5), cur('Orb of Scouring', 1),
    cur("Shaper's Exalted Orb", 300), cur('Exceptional Eldritch Ember', 400), cur('Veiled Chaos Orb', 100), cur('Veiled Exalted Orb', 9000)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [],
  uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const deps: CraftDeps = { mods: MODS, baseItems: { g: BASE }, essences: {}, fossils: new Map(), bench: { crafts: [], meta: {} }, snapshot: SNAP, league: 'Test' }
const tgt = (desired: { slot: 'prefix' | 'suffix'; group: string; label: string }[]) => ({ base: 'Test Gloves', ilvl: 84, desired })
beforeEach(() => { clearModProducerCache(); clearModWeightIndexCache() })

describe('classifyMod', () => {
  it('influence-only mod ⇒ {influence} + add-influence spec', () => {
    const c = classifyMod({ slot: 'suffix', group: 'InfOnly' }, BASE, 84, MODS)
    expect([...c.classes]).toEqual(['influence'])
    expect(c.specs.some(s => s.kind === 'add-influence')).toBe(true)
  })
  it('eldritch-exclusive implicit ⇒ {eldritch} + eldritch-implicit spec', () => {
    const c = classifyMod({ slot: 'prefix', group: 'EldOnly' }, BASE, 84, MODS)
    expect([...c.classes]).toEqual(['eldritch'])
    expect(c.specs.some(s => s.kind === 'eldritch-implicit')).toBe(true)
  })
  it('veiled-exclusive mod ⇒ {veiled} + veiled-chaos/exalt specs', () => {
    const c = classifyMod({ slot: 'prefix', group: 'VeilOnly' }, BASE, 84, MODS)
    expect([...c.classes]).toEqual(['veiled'])
    expect(c.specs.map(s => s.kind).sort()).toEqual(['veiled-chaos', 'veiled-exalt'])
  })
  it('plain explicit ⇒ {core}, zero specialized candidates (no false positives)', () => {
    const c = classifyMod({ slot: 'prefix', group: 'PlainPfx' }, BASE, 84, MODS)
    expect([...c.classes]).toEqual(['core'])
    expect(modProducers({ slot: 'prefix', group: 'PlainPfx' }, BASE, 84, MODS)).toEqual([])
  })
})

describe('producers wired into the search', () => {
  it('influence target solves via an influence exalt', () => {
    const r = searchPlans(tgt([{ slot: 'suffix', group: 'InfOnly', label: 'InfOnly' }]), deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.moves.some(mv => /add-influence|Exalted/i.test(mv.label))).toBe(true)
  })
  it('eldritch target solves via eldritch currency (value-tier flag propagated)', () => {
    const r = searchPlans(tgt([{ slot: 'prefix', group: 'EldOnly', label: 'EldOnly' }]), deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.moves.some(mv => /eldritch/i.test(mv.label))).toBe(true)
    expect(r.cheapestPlan!.flags.length).toBeGreaterThan(0) // pool/value-tier flag rides along
  })
  it('veiled target solves via an unveil', () => {
    const r = searchPlans(tgt([{ slot: 'prefix', group: 'VeilOnly', label: 'VeilOnly' }]), deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.moves.some(mv => /Veiled/i.test(mv.label))).toBe(true)
  })
  it('specialized producer composes with another step (depth ≥ 2)', () => {
    const r = searchPlans(tgt([{ slot: 'suffix', group: 'InfOnly', label: 'InfOnly' }, { slot: 'prefix', group: 'PlainPfx', label: 'PlainPfx' }]), deps)
    const composed = r.plans.find(p => p.depth >= 2 && p.moves.some(mv => /add-influence|Exalted/i.test(mv.label)))
    expect(composed).toBeTruthy()
  })
  it('enforces eldritch ⊥ influence (mixed-class target rejected)', () => {
    const r = searchPlans(tgt([{ slot: 'prefix', group: 'EldOnly', label: 'EldOnly' }, { slot: 'suffix', group: 'InfOnly', label: 'InfOnly' }]), deps)
    expect(r.cheapestPlan).toBeNull()
    expect(r.verdict.rationale).toMatch(/eldritch ⊥ influence|cannot coexist/i)
  })
  it('a plain target uses no specialized producer (still solves via core)', () => {
    const r = searchPlans(tgt([{ slot: 'prefix', group: 'PlainPfx', label: 'PlainPfx' }]), deps)
    expect(r.cheapestPlan).toBeTruthy()
    expect(r.cheapestPlan!.moves.every(mv => !/add-influence|eldritch|Veiled/i.test(mv.label))).toBe(true)
  })
})
