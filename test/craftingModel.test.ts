import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeFossil } from '../src/data/repoe'
import {
  effectiveWeight,
  buildSlotPool,
  slotShare,
  totalWeight,
  magicOccupancy,
  pPresentInSlots,
  fossilWeightMultiplier,
  isAttackMod,
  isCasterMod,
  SLOT_CAPS,
} from '../src/services/craftingModel'

// ── Synthetic, hand-checkable fixture (no network) ───────────────────────────

const mod = (m: Partial<RepoeMod> & Pick<RepoeMod, 'generation_type' | 'groups'>): RepoeMod => ({
  domain: 'item',
  name: 'x',
  type: 'x',
  required_level: 1,
  is_essence_only: false,
  spawn_weights: [{ tag: 'body_armour', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [],
  implicit_tags: [],
  adds_tags: [],
  ...m,
})

const MODS: Record<string, RepoeMod> = {
  LifeT1: mod({ generation_type: 'prefix', groups: ['IncreasedLife'], required_level: 86, implicit_tags: ['life', 'resource'] }),
  LifeT2: mod({ generation_type: 'prefix', groups: ['IncreasedLife'], required_level: 81, implicit_tags: ['life', 'resource'] }),
  EnergyShield: mod({ generation_type: 'prefix', groups: ['EnergyShield'], required_level: 60, implicit_tags: ['defences'], spawn_weights: [{ tag: 'body_armour', weight: 500 }, { tag: 'default', weight: 0 }] }),
  AttackPrefix: mod({ generation_type: 'prefix', groups: ['PhysicalDamage'], implicit_tags: ['attack', 'physical'], spawn_weights: [{ tag: 'body_armour', weight: 200 }, { tag: 'default', weight: 0 }] }),
  EssenceLife: mod({ generation_type: 'prefix', groups: ['IncreasedLife'], is_essence_only: true, implicit_tags: ['life'] }),
  GenWeighted: mod({ generation_type: 'prefix', groups: ['GW'], generation_weights: [{ tag: 'int_armour', weight: 50 }, { tag: 'default', weight: 100 }] }),
  ColdRes: mod({ generation_type: 'suffix', groups: ['ColdResistance'], implicit_tags: ['resistance', 'elemental'], spawn_weights: [{ tag: 'default', weight: 1000 }] }),
  CasterSuffix: mod({ generation_type: 'suffix', groups: ['SpellCrit'], implicit_tags: ['caster'], spawn_weights: [{ tag: 'body_armour', weight: 300 }, { tag: 'default', weight: 0 }] }),
}

const TAGS = new Set(['body_armour', 'armour', 'int_armour', 'default'])

describe('effectiveWeight — tag-based weighting (element 4)', () => {
  it('takes the first matching spawn_weight', () => {
    expect(effectiveWeight(MODS.LifeT2, TAGS)).toBe(1000)
    expect(effectiveWeight(MODS.EnergyShield, TAGS)).toBe(500)
  })
  it('applies the first matching generation_weights percent multiplier', () => {
    // int_armour:50 ⇒ 1000 × 50% = 500
    expect(effectiveWeight(MODS.GenWeighted, TAGS)).toBe(500)
    // without the int_armour tag, falls to default:100 ⇒ unchanged
    expect(effectiveWeight(MODS.GenWeighted, new Set(['body_armour', 'default']))).toBe(1000)
  })
  it('returns 0 when no tag matches (off-base mod)', () => {
    expect(effectiveWeight(MODS.LifeT2, new Set(['ring', 'default']))).toBe(0)
  })
})

describe('buildSlotPool — ilvl gating (element 3)', () => {
  it('excludes tiers above item level', () => {
    const at84 = buildSlotPool(MODS, TAGS, 84, 'prefix')
    expect(at84.map(e => e.id)).toContain('LifeT2')
    expect(at84.map(e => e.id)).not.toContain('LifeT1') // req 86
    const at86 = buildSlotPool(MODS, TAGS, 86, 'prefix')
    expect(at86.map(e => e.id)).toContain('LifeT1')
  })
})

describe('buildSlotPool — group exclusivity (element 1)', () => {
  it('removes the entire group once used', () => {
    const used = new Set(['IncreasedLife'])
    const ids = buildSlotPool(MODS, TAGS, 100, 'prefix', { usedGroups: used }).map(e => e.id)
    expect(ids).not.toContain('LifeT1')
    expect(ids).not.toContain('LifeT2')
    expect(ids).toContain('EnergyShield')
  })
})

describe('slot caps (element 2)', () => {
  it('rare = 3/3, magic = 1/1, normal = 0/0', () => {
    expect(SLOT_CAPS.rare).toEqual({ prefix: 3, suffix: 3 })
    expect(SLOT_CAPS.magic).toEqual({ prefix: 1, suffix: 1 })
    expect(SLOT_CAPS.normal).toEqual({ prefix: 0, suffix: 0 })
  })
})

describe('magic mod-count distribution (element 5)', () => {
  it('occupancy with equal pools ⇒ 0.75 each and P(2-affix)=0.5', () => {
    const occ = magicOccupancy(1000, 1000)
    expect(occ.pPrefix).toBeCloseTo(0.75, 9)
    expect(occ.pSuffix).toBeCloseTo(0.75, 9)
    // P(both slots filled) = P(2-affix) = pPrefix + pSuffix - 1
    expect(occ.pPrefix + occ.pSuffix - 1).toBeCloseTo(0.5, 9)
  })
  it('a lop-sided pool makes the heavy slot more likely occupied', () => {
    const occ = magicOccupancy(3000, 1000) // prefix-heavy
    expect(occ.pPrefix).toBeGreaterThan(occ.pSuffix)
  })
})

describe('meta-mods (element 6)', () => {
  it('classifies attack/caster mods by implicit_tags', () => {
    expect(isAttackMod(MODS.AttackPrefix)).toBe(true)
    expect(isCasterMod(MODS.CasterSuffix)).toBe(true)
    expect(isAttackMod(MODS.LifeT2)).toBe(false)
  })
  it('"cannot roll attack" drops attack mods from the pool', () => {
    const ids = buildSlotPool(MODS, TAGS, 100, 'prefix', { meta: { blockAttack: true } }).map(e => e.id)
    expect(ids).not.toContain('AttackPrefix')
    expect(ids).toContain('LifeT2')
  })
  it('"cannot roll caster" drops caster mods from the suffix pool', () => {
    const ids = buildSlotPool(MODS, TAGS, 100, 'suffix', { meta: { blockCaster: true } }).map(e => e.id)
    expect(ids).not.toContain('CasterSuffix')
    expect(ids).toContain('ColdRes')
  })
  it('"prefixes cannot be changed" locks the prefix slot empty', () => {
    expect(buildSlotPool(MODS, TAGS, 100, 'prefix', { meta: { lockPrefixes: true } })).toHaveLength(0)
    // suffixes still roll
    expect(buildSlotPool(MODS, TAGS, 100, 'suffix', { meta: { lockPrefixes: true } }).length).toBeGreaterThan(0)
  })
})

describe('essence-only exclusion (element 7 support)', () => {
  it('excludes essence-only mods from the normal pool, includes them when allowed', () => {
    const normal = buildSlotPool(MODS, TAGS, 100, 'prefix').map(e => e.id)
    expect(normal).not.toContain('EssenceLife')
    const withEss = buildSlotPool(MODS, TAGS, 100, 'prefix', { allowEssenceOnly: true }).map(e => e.id)
    expect(withEss).toContain('EssenceLife')
  })
})

describe('fossil reweighting (element 8)', () => {
  const dense: RepoeFossil = {
    name: 'Dense Fossil',
    added_mods: [], forced_mods: [],
    positive_mod_weights: [{ tag: 'defences', weight: 1000 }], // ×10
    negative_mod_weights: [{ tag: 'life', weight: 0 }], // removed
  }
  it('zeroes negative-tag mods and multiplies positive-tag mods', () => {
    const pool = buildSlotPool(MODS, TAGS, 100, 'prefix', { fossils: [dense] })
    const ids = pool.map(e => e.id)
    expect(ids).not.toContain('LifeT2') // life ×0
    const es = pool.find(e => e.id === 'EnergyShield')
    expect(es?.weight).toBe(5000) // 500 × 10
  })
  it('forbidden_tags remove a mod; allowed_tags restrict to carriers', () => {
    const forbidLife: RepoeFossil = { name: 'x', added_mods: [], forced_mods: [], positive_mod_weights: [], negative_mod_weights: [], forbidden_tags: ['life'] }
    expect(fossilWeightMultiplier(MODS.LifeT2, [forbidLife])).toBeNull()
    const onlyDefence: RepoeFossil = { name: 'y', added_mods: [], forced_mods: [], positive_mod_weights: [], negative_mod_weights: [], allowed_tags: ['defences'] }
    expect(fossilWeightMultiplier(MODS.EnergyShield, [onlyDefence])).toBe(1)
    expect(fossilWeightMultiplier(MODS.LifeT2, [onlyDefence])).toBeNull()
  })
})

describe('probability primitives', () => {
  it('slotShare sums weighted share of matching mods', () => {
    const pool = buildSlotPool(MODS, TAGS, 100, 'prefix')
    const total = totalWeight(pool)
    const lifeShare = slotShare(pool, e => e.group === 'IncreasedLife')
    const lifeWeight = pool.filter(e => e.group === 'IncreasedLife').reduce((s, e) => s + e.weight, 0)
    expect(lifeShare).toBeCloseTo(lifeWeight / total, 9)
  })
  it('pPresentInSlots is exact for one slot and compounds for many', () => {
    expect(pPresentInSlots(0.2, 1)).toBeCloseTo(0.2, 9)
    expect(pPresentInSlots(0.2, 3)).toBeCloseTo(1 - 0.8 ** 3, 9)
    expect(pPresentInSlots(0, 3)).toBe(0)
  })
})
