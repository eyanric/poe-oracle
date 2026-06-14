import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import { expectedAttempts, type CraftContext, type DesiredMod } from '../src/services/craftMethods'
import { buildSlotPool, slotShare, totalWeight, magicOccupancy } from '../src/services/craftingModel'

const mod = (m: Partial<RepoeMod> & Pick<RepoeMod, 'generation_type' | 'groups'>): RepoeMod => ({
  domain: 'item', name: 'x', type: 'x', required_level: 1, is_essence_only: false,
  spawn_weights: [{ tag: 'body_armour', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], ...m,
})

const MODS: Record<string, RepoeMod> = {
  LifeT2: mod({ generation_type: 'prefix', groups: ['IncreasedLife'], required_level: 81, implicit_tags: ['life'] }),
  EnergyShield: mod({ generation_type: 'prefix', groups: ['EnergyShield'], spawn_weights: [{ tag: 'body_armour', weight: 500 }, { tag: 'default', weight: 0 }] }),
  ColdRes: mod({ generation_type: 'suffix', groups: ['ColdResistance'], spawn_weights: [{ tag: 'default', weight: 1000 }] }),
  FireRes: mod({ generation_type: 'suffix', groups: ['FireResistance'], spawn_weights: [{ tag: 'default', weight: 1000 }] }),
}

const TAGS = new Set(['body_armour', 'armour', 'int_armour', 'default'])
const ctx: CraftContext = { mods: MODS, baseTags: TAGS, ilvl: 84 }

const lifeTarget: DesiredMod = { slot: 'prefix', group: 'IncreasedLife', label: 'Increased Life' }
const coldTarget: DesiredMod = { slot: 'suffix', group: 'ColdResistance', label: 'Cold Resistance' }

describe('essence method (deterministic)', () => {
  it('guarantees the forced mod in one use', () => {
    const r = expectedAttempts(ctx, [lifeTarget], { kind: 'essence', forcedModId: 'LifeT2', essenceName: 'Deafening Essence of Greed' })
    expect(r.supported).toBe(true)
    expect(r.expectedAttempts).toBe(1)
    expect(r.lowConfidence).toBe(false)
    expect(r.consumables).toEqual([{ name: 'Deafening Essence of Greed', qty: 1, category: 'essence' }])
  })
  it('marks extra desired mods (random rare portion) unsupported', () => {
    const r = expectedAttempts(ctx, [lifeTarget, coldTarget], { kind: 'essence', forcedModId: 'LifeT2', essenceName: 'E' })
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/random rare/)
  })
})

describe('alt → regal (magic mod-count aware)', () => {
  it('single-mod EV uses occupancy × slot share, not share alone', () => {
    const r = expectedAttempts(ctx, [lifeTarget], { kind: 'alt-regal' })
    expect(r.supported).toBe(true)
    // hand-recompute expected attempts = 1 / (pPrefix × lifeShare)
    const pre = buildSlotPool(MODS, TAGS, 84, 'prefix')
    const suf = buildSlotPool(MODS, TAGS, 84, 'suffix')
    const occ = magicOccupancy(totalWeight(pre), totalWeight(suf))
    const share = slotShare(pre, e => e.group === 'IncreasedLife')
    expect(r.perAttemptProb).toBeCloseTo(occ.pPrefix * share, 9)
    expect(r.expectedAttempts).toBeCloseTo(1 / (occ.pPrefix * share), 6)
    // and it must be MORE than the naive share-only model (occupancy < 1)
    expect(r.expectedAttempts).toBeGreaterThan(1 / share)
    expect(r.lowConfidence).toBe(true)
    expect(r.consumables.find(c => c.name === 'Regal Orb')?.qty).toBe(1)
  })

  it('two-mod (1 prefix + 1 suffix) uses the P(2-affix) factor, not a naive product', () => {
    const r = expectedAttempts(ctx, [lifeTarget, coldTarget], { kind: 'alt-regal' })
    expect(r.supported).toBe(true)
    const pre = buildSlotPool(MODS, TAGS, 84, 'prefix')
    const suf = buildSlotPool(MODS, TAGS, 84, 'suffix')
    const occ = magicOccupancy(totalWeight(pre), totalWeight(suf))
    const pTwo = occ.pPrefix + occ.pSuffix - 1
    const sharePre = slotShare(pre, e => e.group === 'IncreasedLife')
    const shareSuf = slotShare(suf, e => e.group === 'ColdResistance')
    expect(r.perAttemptProb).toBeCloseTo(pTwo * sharePre * shareSuf, 9)
  })

  it('rejects two same-slot mods (magic caps are 1/1)', () => {
    const r = expectedAttempts(ctx, [coldTarget, { slot: 'suffix', group: 'FireResistance', label: 'Fire Res' }], { kind: 'alt-regal' })
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/same-slot|one prefix/i)
  })

  it('rejects more than two desired mods', () => {
    const r = expectedAttempts(ctx, [lifeTarget, coldTarget, { slot: 'suffix', group: 'FireResistance', label: 'F' }], { kind: 'alt-regal' })
    expect(r.supported).toBe(false)
  })
})

describe('rare reroll (chaos-spam / fossil)', () => {
  it('supports single-mod chaos-spam, flagged low-confidence', () => {
    const r = expectedAttempts(ctx, [lifeTarget], { kind: 'chaos-spam' })
    expect(r.supported).toBe(true)
    expect(r.lowConfidence).toBe(true)
    expect(r.expectedAttempts).toBeGreaterThan(1)
    expect(r.consumables[0].name).toBe('Chaos Orb')
  })
  it('marks multi-mod rare reroll unsupported (needs without-replacement sim)', () => {
    const r = expectedAttempts(ctx, [lifeTarget, coldTarget], { kind: 'chaos-spam' })
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/without-replacement|simulation/i)
  })
})
