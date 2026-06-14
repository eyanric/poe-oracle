import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import { buildInfluenceIndex, influenceRollProbability, influencedTags } from '../src/services/influence'
import { evaluateMethod, evaluateInputs } from '../src/services/craftMethods'
import { newItemState } from '../src/services/itemState'

// Influenced mod: gated by the compound `{slot}_{codename}` tag (weight 0 on the bare base).
const inf = (gen: string, group: string, tag: string, weight = 500, req = 80): RepoeMod => ({
  domain: 'item', generation_type: gen, name: group, type: group, is_essence_only: false, required_level: req,
  groups: [group], spawn_weights: [{ tag, weight }, { tag: 'default', weight: 0 }], generation_weights: [], implicit_tags: [], adds_tags: [], text: group,
})
const MODS: Record<string, RepoeMod> = {
  SHAPER_A: inf('prefix', 'GA', 'body_armour_shaper', 600),
  SHAPER_B: inf('suffix', 'GB', 'body_armour_shaper', 400),
  SHAPER_HIGH: inf('prefix', 'GHi', 'body_armour_shaper', 500, 99), // ilvl-gated out at 86
  HUNTER_A: inf('prefix', 'GH', 'body_armour_basilisk', 500), // hunter codename = basilisk
  REGULAR: { ...inf('prefix', 'GR', 'body_armour', 1000), }, // rolls on the bare base ⇒ not influence-only
}
const tags = new Set(['int_armour', 'body_armour', 'armour', 'default'])

describe('influencedTags + buildInfluenceIndex', () => {
  it('augments base tags with the influence compound tag', () => {
    expect(influencedTags(tags, 'shaper').has('body_armour_shaper')).toBe(true)
    expect(influencedTags(tags, 'hunter').has('body_armour_basilisk')).toBe(true) // codename mapping
  })
  const idx = buildInfluenceIndex(tags, 'shaper', 86, MODS)
  it('includes influence-only mods; excludes base-rollable + ilvl-gated', () => {
    const ids = [...idx.prefixes, ...idx.suffixes].map(e => e.modId)
    expect(ids).toContain('SHAPER_A'); expect(ids).toContain('SHAPER_B')
    expect(ids).not.toContain('REGULAR') // rolls on the bare base
    expect(ids).not.toContain('SHAPER_HIGH') // req 99 > ilvl 86
  })
  it('combined pool total (an exalt rolls one mod across both slots)', () => {
    expect(idx.total).toBe(1000) // 600 + 400
  })
  it('resolves the hunter pool via codename', () => {
    expect(buildInfluenceIndex(tags, 'hunter', 86, MODS).prefixes.map(e => e.modId)).toContain('HUNTER_A')
  })
})

describe('influenceRollProbability', () => {
  const idx = buildInfluenceIndex(tags, 'shaper', 86, MODS)
  it('group = group weight / combined pool', () => {
    expect(influenceRollProbability(idx, { group: 'GA' })).toBeCloseTo(600 / 1000, 6)
  })
  it('modId = its weight / combined pool', () => {
    expect(influenceRollProbability(idx, { modId: 'SHAPER_B' })).toBeCloseTo(400 / 1000, 6)
  })
})

describe('add-influence module', () => {
  const data = { mods: MODS, currentLeague: 'Mirage' }
  const base = (over = {}) => newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 86, tags: [...tags], ...over })
  it('costs a named influenced mod on a no-influence base', () => {
    const r = evaluateMethod(base(), data, { desired: [{ slot: 'prefix', group: 'GA', label: 'GA' }], method: { kind: 'add-influence', influence: 'shaper' } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBeCloseTo(600 / 1000, 6)
    expect(r.consumables[0].name).toBe("Shaper's Exalted Orb")
  })
  it('rejects an already-influenced item', () => {
    const r = evaluateMethod(base({ influence: ['elder'] }), data, { desired: [{ slot: 'prefix', group: 'GA', label: 'GA' }], method: { kind: 'add-influence', influence: 'shaper' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/already influenced/i)
  })
  it('rejects an abstract target (specificity contract)', () => {
    const r = evaluateMethod(base(), data, { desired: [{ slot: 'prefix', label: 'any' }], method: { kind: 'add-influence', influence: 'shaper' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/specific/i)
  })
})

describe("Awakener's Orb (arity-2 channel)", () => {
  const data = { mods: MODS, currentLeague: 'Mirage' }
  const donor = (influence: string, affixes: { slot: 'prefix' | 'suffix'; group: string; modId: string }[]) =>
    newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 86, tags: [...tags], influence: [influence], affixes: affixes.map(a => ({ ...a, influenced: true })) })
  const dHunter = donor('hunter', [{ slot: 'prefix', group: 'GH', modId: 'HUNTER_A' }])
  const dShaper = donor('shaper', [{ slot: 'suffix', group: 'GB', modId: 'SHAPER_B' }])
  const desired = [{ slot: 'prefix' as const, group: 'GH', label: 'H' }, { slot: 'suffix' as const, group: 'GB', label: 'S' }]

  it('single-influenced-mod donors ⇒ guaranteed carry (P=1)', () => {
    const r = evaluateInputs([dHunter, dShaper], data, { desired, method: { kind: 'awakeners' } })
    expect(r.supported).toBe(true); expect(r.perAttemptProb).toBeCloseTo(1, 6)
    expect(r.consumables[0].name).toBe("Awakener's Orb")
  })
  it('a 2-influenced donor halves the carry probability', () => {
    const dMulti = donor('hunter', [{ slot: 'prefix', group: 'GH', modId: 'HUNTER_A' }, { slot: 'suffix', group: 'GB', modId: 'X' }])
    const r = evaluateInputs([dMulti, dShaper], data, { desired, method: { kind: 'awakeners' } })
    expect(r.perAttemptProb).toBeCloseTo(0.5, 6)
  })
  it('rejects same-influence inputs', () => {
    const r = evaluateInputs([dHunter, donor('hunter', [{ slot: 'suffix', group: 'GB', modId: 'SHAPER_B' }])], data, { desired, method: { kind: 'awakeners' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/different influence/i)
  })
  it('rejects different item classes', () => {
    const ring = newItemState({ base: 'x', itemClass: 'Ring', ilvl: 86, tags: ['ring'], influence: ['shaper'], affixes: [{ slot: 'suffix', group: 'GB', modId: 'Z', influenced: true }] })
    const r = evaluateInputs([dHunter, ring], data, { desired, method: { kind: 'awakeners' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/same item class/i)
  })
})

describe('Orb of Dominance', () => {
  const data = { mods: MODS, currentLeague: 'Mirage' }
  const helm = (affixes: { slot: 'prefix' | 'suffix'; group: string; modId: string; influenced?: boolean }[]) =>
    newItemState({ base: 'Hubris Circlet', itemClass: 'Helmet', ilvl: 86, tags: ['int_armour', 'helmet', 'armour', 'default'], affixes })
  it('elevate probability = 1/influenced-count; collateral noted', () => {
    const r = evaluateMethod(helm([{ slot: 'prefix', group: 'GA', modId: 'A', influenced: true }, { slot: 'suffix', group: 'GB', modId: 'B', influenced: true }]), data, { desired: [{ slot: 'prefix', group: 'GA', label: 'A' }], method: { kind: 'orb-of-dominance' } })
    expect(r.supported).toBe(true); expect(r.perAttemptProb).toBeCloseTo(0.5, 6)
    expect(r.notes.join(' ')).toMatch(/collateral/i)
  })
  it('rejects <2 influenced mods', () => {
    const r = evaluateMethod(helm([{ slot: 'prefix', group: 'GA', modId: 'A', influenced: true }]), data, { desired: [], method: { kind: 'orb-of-dominance' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/≥2 influenced|2 influenced/i)
  })
  it('rejects a non-eligible base', () => {
    const ring = newItemState({ base: 'x', itemClass: 'Ring', ilvl: 86, tags: ['ring', 'default'], affixes: [{ slot: 'prefix', group: 'GA', modId: 'A', influenced: true }, { slot: 'suffix', group: 'GB', modId: 'B', influenced: true }] })
    const r = evaluateMethod(ring, data, { desired: [], method: { kind: 'orb-of-dominance' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/body_armour \/ boots/)
  })
})
