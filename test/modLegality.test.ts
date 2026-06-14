import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import { isNative } from '../src/services/modLegality'

const mod = (m: Partial<RepoeMod>): RepoeMod => ({
  domain: 'item', name: 'x', type: 'x', required_level: 1, is_essence_only: false, generation_type: 'suffix',
  groups: [], spawn_weights: [], generation_weights: [], implicit_tags: [], adds_tags: [], ...m,
})

describe('isNative (data-derived legality primitive)', () => {
  // spell suppress: native to DEX/evasion bases, illegal on pure INT bases
  const suppress = mod({ required_level: 60, spawn_weights: [{ tag: 'dex_armour', weight: 1000 }, { tag: 'default', weight: 0 }] })

  it('native when the base tags hit the mod spawn-weights (DEX base)', () => {
    expect(isNative(suppress, new Set(['dex_armour', 'armour', 'default']), 84)).toBe(true)
  })
  it('NON-native on a base whose tags miss the spawn-weights (INT base ⇒ default weight 0)', () => {
    expect(isNative(suppress, new Set(['int_armour', 'armour', 'default']), 84)).toBe(false)
  })
  it('NON-native when item level is below the mod required level', () => {
    expect(isNative(suppress, new Set(['dex_armour', 'default']), 50)).toBe(false)
  })
})
