import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import { magnitudeMultiplier, catalystTags, catalystEligibility, QUALITY_CAP } from '../src/services/catalysts'
import { evaluateMethod } from '../src/services/craftMethods'
import { newItemState } from '../src/services/itemState'

const mod = (group: string, implicitTags: string[]): RepoeMod => ({
  domain: 'item', generation_type: 'suffix', name: group, type: group, is_essence_only: false, required_level: 1,
  groups: [group], spawn_weights: [{ tag: 'ring', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: implicitTags, adds_tags: [], text: group,
})
const MODS: Record<string, RepoeMod> = {
  RES: mod('ColdRes', ['resistance', 'elemental']),
  ATK: mod('AttackSpeed', ['attack', 'speed']),
}
const ringTags = ['twostonering', 'ring', 'default']

describe('catalyst helpers', () => {
  it('magnitudeMultiplier scales by quality, capped at 20%', () => {
    expect(magnitudeMultiplier(20)).toBeCloseTo(1.2, 6)
    expect(magnitudeMultiplier(25)).toBeCloseTo(1.2, 6) // cap
    expect(magnitudeMultiplier(0)).toBeCloseTo(1.0, 6)
    expect(QUALITY_CAP).toBe(20)
  })
  it('catalyst→tag map', () => {
    expect(catalystTags('prismatic')).toEqual(['resistance'])
    expect(catalystTags('noxious')).toEqual(['physical', 'chaos'])
    expect(catalystTags('sinistral')).toEqual([]) // slot-targeted
  })
})

describe('catalystEligibility', () => {
  const ring = newItemState({ base: 'Two-Stone Ring', itemClass: 'Ring', ilvl: 84, tags: ringTags })
  it('accepts ring/amulet/belt', () => {
    expect(catalystEligibility(ring, 'prismatic', 'Mirage').ok).toBe(true)
  })
  it('rejects non-jewellery bases', () => {
    const body = newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 84, tags: ['body_armour', 'armour'] })
    expect(catalystEligibility(body, 'prismatic', 'Mirage').ok).toBe(false)
  })
  it('league-gates Sinistral/Dextral to Mirage; core catalysts are not gated', () => {
    expect(catalystEligibility(ring, 'sinistral', 'Standard').ok).toBe(false)
    expect(catalystEligibility(ring, 'sinistral', 'Mirage').ok).toBe(true)
    expect(catalystEligibility(ring, 'tempering', 'Standard').ok).toBe(true) // core defence catalyst
  })
})

describe('catalyst module', () => {
  const data = { mods: MODS, currentLeague: 'Mirage' }
  const ring = () => newItemState({ base: 'Two-Stone Ring', itemClass: 'Ring', ilvl: 84, tags: ringTags })
  it('is deterministic and consumes the catalyst currency', () => {
    const r = evaluateMethod(ring(), data, { desired: [], method: { kind: 'catalyst', catalyst: 'prismatic', quality: 20 } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBe(1)
    expect(r.consumables[0].name).toBe('Prismatic Catalyst')
    expect(r.notes.join(' ')).toMatch(/3\.15|roll-weight/i) // flags the removed bias
  })
  it('flags a desired mod that does not carry the catalyst tag', () => {
    const r = evaluateMethod(ring(), data, { desired: [{ slot: 'suffix', group: 'AttackSpeed', label: 'Attack Speed' }], method: { kind: 'catalyst', catalyst: 'prismatic' } })
    expect(r.notes.join(' ')).toMatch(/does not carry/i)
  })
  it('confirms a desired mod that carries the tag', () => {
    const r = evaluateMethod(ring(), data, { desired: [{ slot: 'suffix', group: 'ColdRes', label: 'Cold Res' }], method: { kind: 'catalyst', catalyst: 'prismatic' } })
    expect(r.notes.join(' ')).toMatch(/carries the tag/i)
  })
  it('rejects a non-jewellery base', () => {
    const body = newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 84, tags: ['body_armour', 'armour'] })
    const r = evaluateMethod(body, data, { desired: [], method: { kind: 'catalyst', catalyst: 'prismatic' } })
    expect(r.supported).toBe(false)
  })
})
