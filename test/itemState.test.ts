import { describe, it, expect } from 'vitest'
import {
  newItemState, RARITY_CAPS, slotUsage, openSlots, isSlotLocked, canRollGroup,
  withAffix, withBlockedGroup, withMeta, consumeResource, groupsPresent,
} from '../src/services/itemState'

const rare = () => newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 84, tags: ['body_armour'] })

describe('newItemState', () => {
  it('defaults to rare with 3/3 caps and empty everything', () => {
    const s = rare()
    expect(s.rarity).toBe('rare')
    expect(s.caps).toEqual(RARITY_CAPS.rare)
    expect(s.affixes).toEqual([])
    expect(s.resources).toEqual({})
  })
  it('magic items cap at 1/1', () => {
    expect(newItemState({ base: 'x', itemClass: 'Ring', ilvl: 1, rarity: 'magic' }).caps).toEqual({ prefix: 1, suffix: 1 })
  })
})

describe('slot occupancy + locks', () => {
  it('counts usage and open slots', () => {
    let s = rare()
    s = withAffix(s, { modId: 'Life', group: 'IncreasedLife', slot: 'prefix' })
    expect(slotUsage(s, 'prefix')).toBe(1)
    expect(openSlots(s, 'prefix')).toBe(2)
    expect(openSlots(s, 'suffix')).toBe(3)
  })
  it('a protective meta-mod locks its slot (0 open)', () => {
    const s = withMeta(rare(), { lockSuffixes: true })
    expect(isSlotLocked(s, 'suffix')).toBe(true)
    expect(openSlots(s, 'suffix')).toBe(0)
    expect(openSlots(s, 'prefix')).toBe(3) // other side unaffected
  })
})

describe('canRollGroup', () => {
  it('blocks present groups, blocked groups, and full/locked slots', () => {
    let s = rare()
    s = withAffix(s, { modId: 'Life', group: 'IncreasedLife', slot: 'prefix' })
    expect(canRollGroup(s, 'prefix', 'IncreasedLife')).toBe(false) // already present
    expect(canRollGroup(s, 'prefix', 'EnergyShield')).toBe(true)
    const blocked = withBlockedGroup(s, 'EnergyShield')
    expect(blocked.blockedGroups).toContain('EnergyShield')
    expect(canRollGroup(blocked, 'prefix', 'EnergyShield')).toBe(false) // block-to-raise-aug-odds
    expect(groupsPresent(s).has('IncreasedLife')).toBe(true)
  })
})

describe('transforms are immutable', () => {
  it('withAffix / withBlockedGroup / withMeta do not mutate the input', () => {
    const s = rare()
    const a = withAffix(s, { modId: 'x', group: 'g', slot: 'prefix' })
    expect(s.affixes).toHaveLength(0)
    expect(a.affixes).toHaveLength(1)
    expect(withBlockedGroup(s, 'g').blockedGroups).toEqual(['g'])
    expect(s.blockedGroups).toEqual([])
    expect(withMeta(s, { multimod: true }).meta.multimod).toBe(true)
    expect(s.meta.multimod).toBeUndefined()
  })
})

describe('depleting per-item resources (memory strands shape)', () => {
  it('consumeResource depletes and clamps at 0', () => {
    let s = newItemState({ base: 'x', itemClass: 'Ring', ilvl: 1, resources: { memoryStrands: 2 } })
    s = consumeResource(s, 'memoryStrands')
    expect(s.resources.memoryStrands).toBe(1)
    s = consumeResource(s, 'memoryStrands', 5)
    expect(s.resources.memoryStrands).toBe(0) // clamped
  })
})
