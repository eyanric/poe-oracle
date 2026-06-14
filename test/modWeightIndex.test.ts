import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import { buildBaseModIndex, modRollProbability, isSpecificTarget } from '../src/services/modWeightIndex'

const mod = (m: Partial<RepoeMod> & Pick<RepoeMod, 'generation_type' | 'groups' | 'required_level'>): RepoeMod => ({
  domain: 'item', name: m.groups[0], type: 'x', is_essence_only: false,
  spawn_weights: [{ tag: 'int_armour', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], ...m,
})
const MODS: Record<string, RepoeMod> = {
  ES1: mod({ generation_type: 'prefix', groups: ['EnergyShield'], required_level: 60, spawn_weights: [{ tag: 'int_armour', weight: 800 }, { tag: 'default', weight: 0 }] }),
  ES2: mod({ generation_type: 'prefix', groups: ['EnergyShield'], required_level: 84, spawn_weights: [{ tag: 'int_armour', weight: 400 }, { tag: 'default', weight: 0 }] }),
  Spell1: mod({ generation_type: 'prefix', groups: ['SpellDamage'], required_level: 80, spawn_weights: [{ tag: 'int_armour', weight: 200 }, { tag: 'default', weight: 0 }] }),
  EssenceOnly: mod({ generation_type: 'prefix', groups: ['Forced'], required_level: 1, is_essence_only: true }),
  OffBase: mod({ generation_type: 'prefix', groups: ['Phys'], required_level: 1, spawn_weights: [{ tag: 'str_armour', weight: 1000 }, { tag: 'default', weight: 0 }] }),
  Res1: mod({ generation_type: 'suffix', groups: ['ColdRes'], required_level: 40 }),
}
const tags = new Set(['int_armour', 'shield', 'armour', 'default'])

describe('buildBaseModIndex', () => {
  const idx = buildBaseModIndex('Titanium Spirit Shield', 'Shield', tags, 84, MODS)

  it('includes only eligible (resolved weight > 0, not essence-only, ilvl ok) mods', () => {
    const ids = idx.prefixes.map(e => e.modId)
    expect(ids).toContain('ES1'); expect(ids).toContain('ES2'); expect(ids).toContain('Spell1')
    expect(ids).not.toContain('EssenceOnly') // essence-only excluded from base pool
    expect(ids).not.toContain('OffBase') // str-only ⇒ weight 0 on int base
  })

  it('records resolved weight + group + pool totals', () => {
    expect(idx.prefixes.find(e => e.modId === 'ES1')!.weight).toBe(800)
    expect(idx.prefixTotal).toBe(800 + 400 + 200) // ES1 + ES2 + Spell1
    expect(idx.suffixTotal).toBe(1000) // Res1 (int_armour default 1000)
  })

  it('derives tiers within a group (1 = highest required_level)', () => {
    expect(idx.prefixes.find(e => e.modId === 'ES2')!.tier).toBe(1) // req 84
    expect(idx.prefixes.find(e => e.modId === 'ES1')!.tier).toBe(2) // req 60
  })

  it('ilvl gating excludes higher-tier mods', () => {
    const low = buildBaseModIndex('x', 'Shield', tags, 70, MODS)
    expect(low.prefixes.map(e => e.modId)).not.toContain('ES2') // req 84 > 70
  })
})

describe('modRollProbability', () => {
  const idx = buildBaseModIndex('x', 'Shield', tags, 84, MODS)
  it('specific mod (modId) = its weight / pool total', () => {
    expect(modRollProbability(idx, { affix: 'prefix', modId: 'Spell1' })).toBeCloseTo(200 / 1400, 6)
  })
  it('group (any tier) = summed group weight / pool total', () => {
    expect(modRollProbability(idx, { affix: 'prefix', group: 'EnergyShield' })).toBeCloseTo(1200 / 1400, 6)
  })
  it('abstract target (no modId/group) = 0', () => {
    expect(modRollProbability(idx, { affix: 'prefix' })).toBe(0)
  })
})

describe('isSpecificTarget', () => {
  it('true for named mod/group, false for abstract', () => {
    expect(isSpecificTarget({ modId: 'ES1' })).toBe(true)
    expect(isSpecificTarget({ group: 'EnergyShield' })).toBe(true)
    expect(isSpecificTarget({})).toBe(false)
  })
})
