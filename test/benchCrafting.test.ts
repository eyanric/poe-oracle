import { describe, it, expect } from 'vitest'
import type { RepoeBenchOption, RepoeMod } from '../src/data/repoe'
import { normalizeBench, findBenchCraft, BENCH_CURRENCY_NAMES } from '../src/services/benchCrafting'

const mod = (gt: 'prefix' | 'suffix', text: string): RepoeMod => ({
  domain: 'crafted', name: text, type: 't', required_level: 1, is_essence_only: false,
  generation_type: gt, groups: [], spawn_weights: [], generation_weights: [], implicit_tags: [], adds_tags: [], text,
})

const MODS: Record<string, RepoeMod> = {
  HelenaLife1: mod('prefix', '+(80-89) to maximum Life'),
  FireRes1: mod('suffix', '+(46-48)% to Fire Resistance'),
  StrIntMasterItemGenerationCanHaveMultipleCraftedMods: mod('suffix', 'Can have up to 3 Crafted Modifiers'),
  StrMasterItemGenerationCannotChangeSuffixes: mod('prefix', 'Suffixes Cannot Be Changed'),
}

const opt = (modId: string, cost: Record<string, number>, classes = ['Body Armour']): RepoeBenchOption => ({
  actions: { add_explicit_mod: modId }, cost, item_classes: classes, bench_tier: 1,
})

const OPTIONS: RepoeBenchOption[] = [
  opt('HelenaLife1', { 'Metadata/Items/Currency/CurrencyRerollMagic': 2 }),
  opt('FireRes1', { 'Metadata/Items/Currency/CurrencyUpgradeToRare': 2 }),
  opt('StrIntMasterItemGenerationCanHaveMultipleCraftedMods', { 'Metadata/Items/Currency/CurrencyModValues': 2 }, ['Body Armour', 'Ring']),
  opt('StrMasterItemGenerationCannotChangeSuffixes', { 'Metadata/Items/Currency/CurrencyModValues': 2 }),
]

describe('BENCH_CURRENCY_NAMES', () => {
  it('maps metadata currency paths to economy names', () => {
    expect(BENCH_CURRENCY_NAMES.CurrencyModValues).toBe('Divine Orb')
    expect(BENCH_CURRENCY_NAMES.CurrencyRerollMagic).toBe('Orb of Alteration')
    expect(BENCH_CURRENCY_NAMES.CurrencyAddModToRare).toBe('Exalted Orb')
  })
})

describe('normalizeBench', () => {
  const data = normalizeBench(OPTIONS, MODS)

  it('joins bench options to their mod, slot, label, and priced currency', () => {
    const life = data.crafts.find(c => c.modId === 'HelenaLife1')!
    expect(life.slot).toBe('prefix')
    expect(life.label).toMatch(/maximum Life/)
    expect(life.costName).toBe('Orb of Alteration')
    expect(life.costAmount).toBe(2)
    expect(life.meta).toBeNull()
  })

  it('classifies meta-mods with their (pre-3.28 / low-confidence) costs', () => {
    expect(data.meta.multimod?.costName).toBe('Divine Orb')
    expect(data.meta.multimod?.costAmount).toBe(2) // ⚠ pre-3.28 cost
    expect(data.meta.lockSuffixes?.costName).toBe('Divine Orb')
    expect(data.meta.lockSuffixes?.costAmount).toBe(2)
  })

  it('findBenchCraft matches by term + item class', () => {
    expect(findBenchCraft(data, 'Body Armour', 'Life')?.modId).toBe('HelenaLife1')
    expect(findBenchCraft(data, 'Body Armour', 'Fire Resistance')?.modId).toBe('FireRes1')
    expect(findBenchCraft(data, 'Wand', 'Life')).toBeNull() // wrong class
    expect(findBenchCraft(data, 'Body Armour', 'Nonexistent')).toBeNull()
  })
})
