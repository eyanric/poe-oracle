import { describe, it, expect } from 'vitest'
import type { RepoeBaseItem } from '../src/data/repoe'
import type { EconomySnapshot } from '../src/services/economyTypes'
import type { CraftDeps } from '../src/services/craftCost'
import { SYNTHESIS_POOL, synthesisPoolSize, isSynthesisImplicit } from '../src/data/synthesisImplicits'
import { evaluateMethod } from '../src/services/craftMethods'
import { classifyMod } from '../src/services/modProducer'
import { searchPlans } from '../src/services/solver'
import { newItemState, withSynthImplicit, stateKey } from '../src/services/itemState'

const RING: RepoeBaseItem = { name: 'Two-Stone Ring', domain: 'item', item_class: 'Ring', tags: ['ring', 'default'], release_state: 'released' }
const ringModId = SYNTHESIS_POOL['Ring'].mods[0] // a real synthesis implicit on Ring (from the generated pool)
const cur = (n: string, v: number) => ({ currencyTypeName: n, chaosEquivalent: v, receive: { value: v, listing_count: 50 } })
const SNAP: EconomySnapshot = {
  league: 'T', fetchedAt: 0, currency: [cur('Divine Orb', 200), cur('Chaos Orb', 1)],
  fragments: [], essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [], uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [], oils: [],
}
const deps: CraftDeps = { mods: {}, baseItems: { r: RING }, essences: {}, fossils: new Map(), bench: { crafts: [], meta: {} }, snapshot: SNAP, league: 'T' }

describe('synthesis pool data (generated from poewiki Cargo)', () => {
  it('covers the gear item classes with non-empty pools', () => {
    expect(Object.keys(SYNTHESIS_POOL).length).toBeGreaterThanOrEqual(20)
    expect(synthesisPoolSize('Amulet')!).toBeGreaterThan(100)
    expect(synthesisPoolSize('Ring')!).toBeGreaterThan(100)
  })
  it('membership: a pooled implicit is recognised, a fake one is not', () => {
    expect(isSynthesisImplicit('Ring', ringModId)).toBe(true)
    expect(isSynthesisImplicit('Ring', 'SynthesisImplicitNotARealMod')).toBe(false)
    expect(isSynthesisImplicit('Belt', ringModId && 'SynthesisImplicitNope')).toBe(false)
  })
})

describe('synthesis-reroll uses the data-derived pool size (uniform — no weights exist)', () => {
  const data = { mods: {}, currentLeague: 'T' }
  const ring = () => newItemState({ base: 'Two-Stone Ring', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'] })
  it('a real Ring implicit needs no caller poolSize — P = 1/pool(Ring)', () => {
    const r = evaluateMethod(ring(), data, { desired: [{ slot: 'prefix', modId: ringModId, label: ringModId }], method: { kind: 'synthesis-reroll' } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBeCloseTo(1 / synthesisPoolSize('Ring')!, 8)
    expect(r.notes.join(' ')).toMatch(/UNIFORM|no spawn weights/i)
  })
  it('a non-pool modId without a caller poolSize is unsupported (not invented)', () => {
    const r = evaluateMethod(ring(), data, { desired: [{ slot: 'prefix', modId: 'SynthesisImplicitNotReal', label: 'x' }], method: { kind: 'synthesis-reroll' } })
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/not a known synthesis implicit|poolSize/i)
  })
})

describe('synthesis producer (modProducer.classifyMod)', () => {
  const target = { slot: 'prefix' as const, modId: ringModId, label: ringModId, synthImplicit: true }
  it('a synthesis-implicit target → the synthesis-reroll producer with the real pool size', () => {
    const c = classifyMod(target, RING, 84, {})
    expect(c.classes.has('synthesis')).toBe(true)
    expect(c.specs).toEqual([{ kind: 'synthesis-reroll', poolSize: synthesisPoolSize('Ring') }])
  })
  it('a non-pool implicit → no synthesis candidate (no false positive)', () => {
    const c = classifyMod({ slot: 'prefix', modId: 'SynthesisImplicitNotReal', synthImplicit: true }, RING, 84, {})
    expect(c.classes.has('synthesis')).toBe(false)
    expect(c.specs).toEqual([])
  })
})

describe('synthesis implicit slot model (solver)', () => {
  it('withSynthImplicit adds to the implicit slot, not the affixes, and changes the state key', () => {
    const bare = newItemState({ base: 'Two-Stone Ring', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'], rarity: 'rare' })
    const s = withSynthImplicit(bare, ringModId)
    expect(s.synthImplicits).toEqual([ringModId])
    expect(s.affixes).toEqual(bare.affixes)
    expect(stateKey(s)).not.toBe(stateKey(bare))
  })
  it('a present synthesis implicit already satisfies the target ⇒ depth 0 (goal test)', () => {
    const start = withSynthImplicit(newItemState({ base: 'Two-Stone Ring', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'], rarity: 'rare' }), ringModId)
    const r = searchPlans({ base: 'Two-Stone Ring', ilvl: 84, start, desired: [{ slot: 'prefix', modId: ringModId, label: ringModId, synthImplicit: true }] }, deps)
    expect(r.cheapestPlan!.depth).toBe(0)
  })
})
