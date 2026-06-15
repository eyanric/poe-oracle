import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import type { BenchData } from '../src/services/benchCrafting'
import { solve } from '../src/services/solver'
import { newItemState, stateKey } from '../src/services/itemState'

const mod = (m: Partial<RepoeMod> & Pick<RepoeMod, 'generation_type' | 'groups'>): RepoeMod => ({
  domain: 'item', name: m.groups[0], type: 'x', is_essence_only: false, required_level: 1,
  spawn_weights: [{ tag: 'ring', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], ...m,
})
const MODS: Record<string, RepoeMod> = {
  Life: mod({ generation_type: 'prefix', groups: ['IncreasedLife'], text: '+(10-20) to maximum Life' }),
  ColdRes: mod({ generation_type: 'suffix', groups: ['ColdRes'], text: '+(20-30)% to Cold Resistance' }),
  // shield-only prefixes/suffixes (for the recipe shape)
  ShP1: mod({ generation_type: 'prefix', groups: ['ShP1'], spawn_weights: [{ tag: 'shield', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  ShP2: mod({ generation_type: 'prefix', groups: ['ShP2'], spawn_weights: [{ tag: 'shield', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  ShS1: mod({ generation_type: 'suffix', groups: ['ShS1'], spawn_weights: [{ tag: 'shield', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  ShS2: mod({ generation_type: 'suffix', groups: ['ShS2'], spawn_weights: [{ tag: 'shield', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  // weapon-only: cannot roll on a ring
  WeaponPhys: mod({ generation_type: 'prefix', groups: ['LocalPhysicalDamagePercent'], spawn_weights: [{ tag: 'weapon', weight: 1000 }, { tag: 'default', weight: 0 }] }),
}
const BASES: Record<string, RepoeBaseItem> = {
  ring: { name: 'Test Ring', domain: 'item', item_class: 'Ring', tags: ['ring', 'default'], release_state: 'released' },
  shield: { name: 'Test Shield', domain: 'item', item_class: 'Shield', tags: ['shield', 'default'], release_state: 'released' },
}
const cur = (currencyTypeName: string, chaosEquivalent: number) => ({ currencyTypeName, chaosEquivalent, receive: { value: chaosEquivalent, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'Test', fetchedAt: 0,
  currency: [cur('Divine Orb', 200), cur('Orb of Alteration', 0.1), cur('Regal Orb', 0.2), cur('Chaos Orb', 1), cur('Orb of Alchemy', 0.5), cur('Exalted Orb', 5)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [],
  uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const BENCH: BenchData = {
  crafts: [{ modId: 'LifeMod', slot: 'prefix', label: 'maximum Life', itemClasses: ['Ring'], costName: 'Orb of Alteration', costAmount: 1, meta: null }],
  meta: {},
}
const deps: CraftDeps = { mods: MODS, baseItems: BASES, essences: {}, fossils: new Map(), bench: BENCH, snapshot: SNAP, league: 'Test' }

describe('solver spine', () => {
  it('deterministic-cheap-first: a benchable mod resolves to bench, not a stochastic method', () => {
    const r = solve({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'maximum Life' }] }, deps)
    expect(r.cheapest).toBeTruthy()
    expect(r.cheapest!.id).toMatch(/bench/i)
    // bench cheaper than the alt-regal stochastic path
    const alt = r.paths.find(p => p.id.includes('alt'))
    if (alt?.expectedChaos != null && r.cheapest!.expectedChaos != null) expect(r.cheapest!.expectedChaos).toBeLessThanOrEqual(alt.expectedChaos)
  })

  it('producibility gate: a weapon-only mod on a ring yields no supported path (excluded, not mis-costed)', () => {
    const r = solve({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', group: 'LocalPhysicalDamagePercent', label: 'increased Physical Damage' }] }, deps)
    expect(r.paths.every(p => !p.supported)).toBe(true)
    expect(r.cheapest).toBeNull()
  })

  it('goal test / capacity gating: single-mod methods are not proposed for a 2-mod target', () => {
    const r = solve({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'maximum Life' }, { slot: 'suffix', group: 'ColdRes', label: 'Cold Resistance' }] }, deps)
    const ids = r.paths.map(p => p.id)
    expect(ids.some(i => /slam/i.test(i))).toBe(false)
    expect(ids.some(i => /chaos-spam/i.test(i))).toBe(false)
    expect(ids.some(i => /alt/i.test(i))).toBe(true) // alt-regal handles 1p+1s
  })

  it('rejects an abstract target', () => {
    const r = solve({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', label: 'any prefix' }] }, deps)
    expect(r.cheapest).toBeNull()
    expect(r.verdict.rationale).toMatch(/abstract|specific/i)
  })

  it('encapsulated recipe: a shield 4-mod target surfaces the NNN ladder as one ranked path', () => {
    const r = solve({
      base: 'Test Shield', ilvl: 84, desired: [
        { slot: 'prefix', group: 'ShP1', label: 'p1' }, { slot: 'prefix', group: 'ShP2', label: 'p2' },
        { slot: 'suffix', group: 'ShS1', label: 's1' }, { slot: 'suffix', group: 'ShS2', label: 's2' },
      ],
    }, deps)
    const recipe = r.paths.find(p => p.kind === 'recipe')
    expect(recipe).toBeTruthy()
    expect(recipe!.confidence).toBe('low') // confidence propagated
    expect(recipe!.flags.length).toBeGreaterThan(0)
  })

  it('canonical key is stable + order-independent', () => {
    const a = newItemState({ base: 'X', itemClass: 'Ring', ilvl: 84, tags: ['ring'], affixes: [{ slot: 'prefix', group: 'A', modId: 'A1' }, { slot: 'suffix', group: 'B', modId: 'B1' }] })
    const b = newItemState({ base: 'X', itemClass: 'Ring', ilvl: 84, tags: ['ring'], affixes: [{ slot: 'suffix', group: 'B', modId: 'B1' }, { slot: 'prefix', group: 'A', modId: 'A1' }] })
    expect(stateKey(a)).toBe(stateKey(b))
    const c = newItemState({ base: 'X', itemClass: 'Ring', ilvl: 84, tags: ['ring'], resources: { memoryStrands: 50 } })
    expect(stateKey(c)).not.toBe(stateKey(a))
  })

  it('reports the start state canonical key on the result', () => {
    const r = solve({ base: 'Test Ring', ilvl: 84, desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'maximum Life' }] }, deps)
    expect(r.startKey).toContain('Test Ring')
  })
})
