import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import { respectsLock, blockedOnLockedItem, lockInteraction } from '../src/services/lockMatrix'
import { newItemState, withMeta, withAffix } from '../src/services/itemState'
import { searchPlans } from '../src/services/solver'

describe('lock matrix (single source of truth)', () => {
  it('RESPECT set: Chaos / Harvest reforge / Scour / Exalt(slam) / Annul / Alt / Veiled-Chaos', () => {
    for (const k of ['chaos-spam', 'harvest', 'scour', 'slam', 'eldritch-annul', 'alt-regal', 'veiled-chaos']) {
      expect(lockInteraction(k)).toBe('respect')
      expect(respectsLock(k)).toBe(true)
    }
  })
  it('IGNORE set: Awakener\'s / Orb of Dominance / Unravelling (reproduction applies)', () => {
    for (const k of ['awakeners', 'orb-of-dominance', 'unravelling']) {
      expect(lockInteraction(k)).toBe('ignore')
      expect(respectsLock(k)).toBe(false)
    }
  })
  it('BLOCKED set: Essence + Fossil are illegal on a Cannot-Be-Changed item', () => {
    expect(blockedOnLockedItem('essence')).toBe(true)
    expect(blockedOnLockedItem('fossil')).toBe(true)
    // blocked methods don't WIPE the locked side either ⇒ respectsLock is true (not 'ignore')
    expect(respectsLock('essence')).toBe(true)
  })
  it('unknown method defaults to respect', () => {
    expect(lockInteraction('totally-made-up')).toBe('respect')
  })
})

// ── solver filters BLOCKED methods (essence) once a Cannot-Be-Changed lock is on the item ──
const m = (gen: 'prefix' | 'suffix', group: string): RepoeMod => ({
  domain: 'item', generation_type: gen, name: group, type: group, is_essence_only: false, required_level: 1,
  groups: [group], spawn_weights: [{ tag: 'ring', weight: 1000 }, { tag: 'default', weight: 0 }], generation_weights: [], implicit_tags: [], adds_tags: [], text: group,
})
const MODS: Record<string, RepoeMod> = { L: m('prefix', 'PfxLife'), R: m('suffix', 'SfxRes') }
const ESSENCES = { greed: { name: 'Essence of Greed', level: 1, item_level_restriction: null, mods: { Ring: 'L' } } } // forces the prefix
const BASE: RepoeBaseItem = { name: 'Test Ring', domain: 'item', item_class: 'Ring', tags: ['ring', 'default'], release_state: 'released' }
const cur = (n: string, v: number) => ({ currencyTypeName: n, chaosEquivalent: v, receive: { value: v, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'T', fetchedAt: 0, currency: [cur('Divine Orb', 200), cur('Orb of Alteration', 0.1), cur('Regal Orb', 0.2), cur('Chaos Orb', 1), cur('Exalted Orb', 5), cur('Orb of Scouring', 1), cur('Essence of Greed', 5)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [], uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const deps: CraftDeps = { mods: MODS, baseItems: { r: BASE }, essences: ESSENCES as unknown as CraftDeps['essences'], fossils: new Map(), bench: { crafts: [], meta: {} }, snapshot: SNAP, league: 'T' }

describe('solver respects the BLOCKED rule', () => {
  it('essence is NOT generated as a move once the item carries a Cannot-Be-Changed lock', () => {
    // start: a rare ring with the suffix present + suffixes locked; remaining = the prefix (essence-forceable).
    const start = withMeta(withAffix(newItemState({ base: 'Test Ring', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'], rarity: 'rare' }), { slot: 'suffix', group: 'SfxRes', modId: 'R' }), { lockSuffixes: true })
    const r = searchPlans({ base: 'Test Ring', ilvl: 84, start, desired: [{ slot: 'suffix', group: 'SfxRes', label: 'R' }, { slot: 'prefix', group: 'PfxLife', label: 'L' }] }, deps)
    const usesEssence = r.plans.some(p => p.moves.some(mv => /essence/i.test(mv.label)))
    expect(usesEssence).toBe(false) // blocked on the locked item
    expect(r.cheapestPlan).toBeTruthy() // still solvable by a non-blocked method (alt-regal / chaos)
  })
})
