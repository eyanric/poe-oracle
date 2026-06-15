import { describe, it, expect } from 'vitest'
import type { RepoeBenchOption, RepoeMod } from '../src/data/repoe'
import { normalizeBench } from '../src/services/benchCrafting'
import { BENCH_COST_OVERRIDES } from '../src/data/benchCostOverrides'

const mod = (gt: 'prefix' | 'suffix', text: string): RepoeMod => ({
  domain: 'crafted', name: text, type: 't', required_level: 1, is_essence_only: false,
  generation_type: gt, groups: [], spawn_weights: [], generation_weights: [], implicit_tags: [], adds_tags: [], text,
})
const MODS: Record<string, RepoeMod> = { HelenaLife1: mod('prefix', '+(80-89) to maximum Life') }
const OPTIONS: RepoeBenchOption[] = [
  { actions: { add_explicit_mod: 'HelenaLife1' }, cost: { 'Metadata/Items/Currency/CurrencyRerollMagic': 1 }, item_classes: ['Ring'], bench_tier: 1 },
]

describe('bench-cost override seam', () => {
  it('ships empty (parity-safe — export amounts unchanged until verified amounts are sourced)', () => {
    expect(Object.keys(BENCH_COST_OVERRIDES)).toHaveLength(0)
  })

  it('uses the export amount when no override is supplied', () => {
    const c = normalizeBench(OPTIONS, MODS).crafts.find(c => c.modId === 'HelenaLife1')!
    expect(c.costName).toBe('Orb of Alteration')
    expect(c.costAmount).toBe(1)
  })

  it('a verified override (keyed by mod id) replaces the export currency + amount', () => {
    const c = normalizeBench(OPTIONS, MODS, { HelenaLife1: { costName: 'Exalted Orb', costAmount: 2 } }).crafts.find(c => c.modId === 'HelenaLife1')!
    expect(c.costName).toBe('Exalted Orb')
    expect(c.costAmount).toBe(2)
  })
})
