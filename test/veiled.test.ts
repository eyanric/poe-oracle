import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import { buildVeiledPool, unveilShare, pUnveil, UNVEIL_CHOICES } from '../src/services/veiled'
import { evaluateMethod } from '../src/services/craftMethods'
import { newItemState } from '../src/services/itemState'

const unv = (group: string, weight: number, affix = 'prefix', req = 1): RepoeMod => ({
  domain: 'unveiled', generation_type: affix, name: group, type: group, is_essence_only: false, required_level: req,
  groups: [group], spawn_weights: [{ tag: 'gloves', weight }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], text: group,
})
const MODS: Record<string, RepoeMod> = {
  V_LIFE: unv('IncreasedLife', 1000),
  V_FIRE: unv('ConvertFire', 2000),
  V_COLD: unv('ConvertCold', 2000),
  V_HIGH: unv('HighReq', 1000, 'prefix', 99), // ilvl-gated out at 84
  V_SUF: unv('SuffixVeil', 1000, 'suffix'),
}
const tags = ['gloves', 'dex_int_armour', 'armour', 'default']

describe('buildVeiledPool / unveilShare / pUnveil', () => {
  const pool = buildVeiledPool(new Set(tags), 'prefix', 84, MODS)
  it('pool = unveiled-domain mods of the affix, ilvl-gated', () => {
    const ids = pool.entries.map(e => e.modId)
    expect(ids.sort()).toEqual(['V_COLD', 'V_FIRE', 'V_LIFE'])
    expect(pool.total).toBe(5000) // 1000 + 2000 + 2000 (HighReq gated, Suffix wrong affix)
  })
  it('exclude (blocking) shrinks the pool and raises the desired share', () => {
    const blocked = buildVeiledPool(new Set(tags), 'prefix', 84, MODS, new Set(['ConvertFire', 'ConvertCold']))
    expect(blocked.total).toBe(1000)
    expect(unveilShare(blocked, { group: 'IncreasedLife' })).toBeCloseTo(1, 6)
  })
  it('unveilShare + pUnveil (1-of-3)', () => {
    expect(unveilShare(pool, { group: 'IncreasedLife' })).toBeCloseTo(0.2, 6)
    expect(UNVEIL_CHOICES).toBe(3)
    expect(pUnveil(0.2)).toBeCloseTo(1 - 0.8 ** 3, 6)
  })
})

describe('veiled modules', () => {
  const data = { mods: MODS, currentLeague: 'Mirage' }
  const gloves = (over = {}) => newItemState({ base: 'Fingerless Silk Gloves', itemClass: 'Gloves', ilvl: 84, tags: [...tags], ...over })
  const desired = [{ slot: 'prefix' as const, group: 'IncreasedLife', label: 'Life' }]

  it('veiled-chaos costs the named veil and flags destructiveness', () => {
    const r = evaluateMethod(gloves(), data, { desired, method: { kind: 'veiled-chaos' } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBeCloseTo(pUnveil(0.2), 6)
    expect(r.consumables[0].name).toBe('Veiled Chaos Orb')
    expect(r.notes.join(' ')).toMatch(/destructive/i)
  })
  it('Veiled Chaos and Veiled Exalt draw the SAME pool ⇒ identical P', () => {
    const c = evaluateMethod(gloves(), data, { desired, method: { kind: 'veiled-chaos' } })
    const e = evaluateMethod(gloves(), data, { desired, method: { kind: 'veiled-exalt' } })
    expect(c.perAttemptProb).toBeCloseTo(e.perAttemptProb, 9)
    expect(e.consumables[0].name).toBe('Veiled Exalted Orb')
  })
  it('blocking heavy veils (blockedGroups) raises P(desired)', () => {
    const base = evaluateMethod(gloves(), data, { desired, method: { kind: 'veiled-chaos' } })
    const blocked = evaluateMethod(gloves({ blockedGroups: ['ConvertFire', 'ConvertCold'] }), data, { desired, method: { kind: 'veiled-chaos' } })
    expect(blocked.perAttemptProb).toBeGreaterThan(base.perAttemptProb)
    expect(blocked.perAttemptProb).toBeCloseTo(1, 6) // only IncreasedLife left
  })
  it('Veiled Exalt requires an open slot (non-destructive add)', () => {
    const full = gloves({ affixes: [{ slot: 'prefix', group: 'A', modId: 'A' }, { slot: 'prefix', group: 'B', modId: 'B' }, { slot: 'prefix', group: 'C', modId: 'C' }] })
    const r = evaluateMethod(full, data, { desired, method: { kind: 'veiled-exalt' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/open prefix slot/i)
  })
  it('rejects an abstract veiled target', () => {
    const r = evaluateMethod(gloves(), data, { desired: [{ slot: 'prefix', label: 'any veiled' }], method: { kind: 'veiled-chaos' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/specific veiled/i)
  })
  it('rejects a veil not in the pool', () => {
    const r = evaluateMethod(gloves(), data, { desired: [{ slot: 'prefix', group: 'NotAVeil', label: 'x' }], method: { kind: 'veiled-chaos' } })
    expect(r.supported).toBe(false)
  })
})
