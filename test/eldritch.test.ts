import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import {
  buildEldritchIndex, eldritchRollProbability, eldritchEligibility, isInfluenced, orbOfConflictEV,
} from '../src/services/eldritch'
import { evaluateMethod } from '../src/services/craftMethods'
import { newItemState } from '../src/services/itemState'

// Synthetic eldritch implicit: tier from the `no_tier_N` gate; presence variants via type suffix.
const eImp = (gen: string, group: string, value: string, tier: number, opts: Partial<{ baseTag: string; weight: number; typeSuffix: string }> = {}): RepoeMod => {
  const baseTag = opts.baseTag ?? 'boots'
  return {
    domain: 'item', generation_type: gen, name: '', type: group + (opts.typeSuffix ?? ''), is_essence_only: false,
    required_level: 75, groups: [group],
    spawn_weights: [{ tag: `no_tier_${tier}_eldritch_implicit`, weight: 0 }, { tag: baseTag, weight: opts.weight ?? 1000 }, { tag: 'default', weight: 0 }],
    generation_weights: [], implicit_tags: [], adds_tags: [], text: value,
  }
}
const explicitPrefix = (group: string, weight = 1000): RepoeMod => ({
  domain: 'item', generation_type: 'prefix', name: group, type: group, is_essence_only: false, required_level: 1,
  groups: [group], spawn_weights: [{ tag: 'boots', weight }, { tag: 'default', weight: 0 }], generation_weights: [], implicit_tags: [], adds_tags: [], text: group,
})

const MODS: Record<string, RepoeMod> = {
  EX_MS1: eImp('searing_exarch_implicit', 'MoveSpeed', '10% increased Movement Speed', 1),
  EX_MS6: eImp('searing_exarch_implicit', 'MoveSpeed', '8% increased Movement Speed', 6),
  EX_MS_PRES: eImp('searing_exarch_implicit', 'MoveSpeed', '12% increased Movement Speed', 1, { typeSuffix: 'UniquePresence' }),
  EX_FIRE: eImp('searing_exarch_implicit', 'FireRes', '+24% to Fire Resistance', 1),
  EX_GLOVES: eImp('searing_exarch_implicit', 'GloveOnly', 'glove thing', 1, { baseTag: 'gloves' }),
  EA_REGEN: eImp('eater_of_worlds_implicit', 'LifeRegen', '12% increased Life Regeneration rate', 1),
  P_LIFE: explicitPrefix('Life'),
}
const boots = new Set(['str_armour', 'boots', 'armour', 'default'])

describe('buildEldritchIndex', () => {
  const idx = buildEldritchIndex(boots, 'exarch', MODS)
  it('includes base-variant rows eligible on the base; excludes presence variants + off-base', () => {
    const ids = idx.entries.map(e => e.modId)
    expect(ids).toContain('EX_MS1'); expect(ids).toContain('EX_MS6'); expect(ids).toContain('EX_FIRE')
    expect(ids).not.toContain('EX_MS_PRES') // UniquePresence value-variant excluded
    expect(ids).not.toContain('EX_GLOVES') // gloves-only ⇒ weight 0 on boots
  })
  it('records pool total + group count + tier from the gate', () => {
    expect(idx.total).toBe(3000) // MS1 + MS6 + FireRes
    expect(idx.groups).toBe(2)
    expect(idx.entries.find(e => e.modId === 'EX_MS1')!.tier).toBe(1)
    expect(idx.entries.find(e => e.modId === 'EX_MS6')!.tier).toBe(6)
  })
})

describe('eldritchRollProbability', () => {
  const idx = buildEldritchIndex(boots, 'exarch', MODS)
  it('group (any value) = summed group weight / pool', () => {
    expect(eldritchRollProbability(idx, { group: 'MoveSpeed' })).toBeCloseTo(2000 / 3000, 6)
  })
  it('specific modId = its row weight / pool', () => {
    expect(eldritchRollProbability(idx, { modId: 'EX_MS1' })).toBeCloseTo(1000 / 3000, 6)
  })
  it('group pinned to a value tier', () => {
    expect(eldritchRollProbability(idx, { group: 'MoveSpeed', tier: 1 })).toBeCloseTo(1000 / 3000, 6)
  })
  it('eater pool is separate', () => {
    const ea = buildEldritchIndex(boots, 'eater', MODS)
    expect(ea.entries.map(e => e.modId)).toEqual(['EA_REGEN'])
  })
})

describe('eldritchEligibility (eldritch ⊥ influence)', () => {
  const base = (over = {}) => newItemState({ base: 'x', itemClass: 'Boots', ilvl: 84, tags: [...boots], ...over })
  it('rejects influenced items and names the rule', () => {
    const r = eldritchEligibility(base({ influence: ['shaper'] }))
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/eldritch ⊥ influence/i)
  })
  it('rejects corrupted items', () => {
    expect(eldritchEligibility(base({ corrupted: true })).ok).toBe(false)
  })
  it('rejects non-eligible base types', () => {
    const r = eldritchEligibility(newItemState({ base: 'x', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'] }))
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/gloves \/ boots/)
  })
  it('accepts an eligible, uninfluenced base', () => {
    expect(eldritchEligibility(base()).ok).toBe(true)
  })
  it('isInfluenced primitive', () => {
    expect(isInfluenced(base({ influence: ['elder'] }))).toBe(true)
    expect(isInfluenced(base())).toBe(false)
  })
})

describe('eldritch modules via evaluateMethod', () => {
  const data = { mods: MODS, currentLeague: 'Mirage' }
  const state = (over = {}) => newItemState({ base: 'Iron Greaves', itemClass: 'Boots', ilvl: 84, tags: [...boots], ...over })

  it('eldritch-implicit costs a named implicit (Exarch=prefix side)', () => {
    const r = evaluateMethod(state(), data, { desired: [{ slot: 'prefix', group: 'MoveSpeed', label: 'MS' }], method: { kind: 'eldritch-implicit' } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBeCloseTo(2000 / 3000, 6)
    expect(r.consumables[0].name).toBe('Exceptional Eldritch Ember')
  })
  it('eldritch-implicit rejects an abstract target (specificity contract)', () => {
    const r = evaluateMethod(state(), data, { desired: [{ slot: 'prefix', label: 'any implicit' }], method: { kind: 'eldritch-implicit' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/specific|specificity/i)
  })
  it('eldritch-implicit rejects an influenced item', () => {
    const r = evaluateMethod(state({ influence: ['shaper'] }), data, { desired: [{ slot: 'prefix', group: 'MoveSpeed', label: 'MS' }], method: { kind: 'eldritch-implicit' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/influence/i)
  })
  it('dominance annul targets the correct side', () => {
    const affixes = [{ slot: 'prefix' as const, group: 'P1', modId: 'P1' }, { slot: 'suffix' as const, group: 'S1', modId: 'S1' }]
    const ex = evaluateMethod(state({ affixes }), data, { desired: [], method: { kind: 'eldritch-annul', dominant: 'exarch' } })
    const ea = evaluateMethod(state({ affixes }), data, { desired: [], method: { kind: 'eldritch-annul', dominant: 'eater' } })
    expect(ex.method).toMatch(/prefix/); expect(ea.method).toMatch(/suffix/)
  })
  it('eldritch-exalt adds to the dominant explicit side', () => {
    const r = evaluateMethod(state(), data, { desired: [{ slot: 'prefix', group: 'Life', label: 'Life' }], method: { kind: 'eldritch-exalt', dominant: 'exarch' } })
    expect(r.supported).toBe(true)
    expect(r.consumables[0].name).toBe('Eldritch Exalted Orb')
  })
})

describe('orbOfConflictEV (flagged representative)', () => {
  it('representative orbs = 2 × tier gain, with a flag note', () => {
    expect(orbOfConflictEV(4, 1).orbs).toBe(6)
    expect(orbOfConflictEV(1, 1).orbs).toBe(0)
    expect(orbOfConflictEV(4, 1).note).toMatch(/representative|NOT simulated/i)
  })
})
