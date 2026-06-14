import { describe, it, expect } from 'vitest'
import { OIL_TIERS, ANOINT_RECIPES } from '../src/services/anoint'
import { evaluateMethod } from '../src/services/craftMethods'
import { newItemState } from '../src/services/itemState'

const data = { mods: {}, currentLeague: 'Mirage' }
const amulet = () => newItemState({ base: 'Onyx Amulet', itemClass: 'Amulet', ilvl: 1, tags: ['amulet', 'default'] })

describe('anoint data', () => {
  it('13 oil tiers, cheapest → priciest', () => {
    expect(OIL_TIERS).toHaveLength(13)
    expect(OIL_TIERS[0]).toBe('Clear'); expect(OIL_TIERS[12]).toBe('Golden')
  })
  it('seed recipe table has the confirmed Whispers of Doom = 3 Golden', () => {
    expect(ANOINT_RECIPES['Whispers of Doom']).toEqual(['Golden', 'Golden', 'Golden'])
  })
})

describe('anoint module', () => {
  it('named notable (seed) → deterministic 3-oil cost', () => {
    const r = evaluateMethod(amulet(), data, { desired: [], method: { kind: 'anoint', notable: 'Whispers of Doom' } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBe(1)
    expect(r.consumables).toEqual([{ name: 'Golden Oil', qty: 3, category: 'oil' }]) // same oil aggregated
  })
  it('explicit oils price any anoint (distinct oils → separate consumables)', () => {
    const r = evaluateMethod(amulet(), data, { desired: [], method: { kind: 'anoint', oils: ['Clear', 'Sepia', 'Amber'] } })
    expect(r.supported).toBe(true)
    expect(r.consumables.map(c => c.name).sort()).toEqual(['Amber Oil', 'Clear Oil', 'Sepia Oil'])
  })
  it('rejects a non-amulet base', () => {
    const ring = newItemState({ base: 'Two-Stone Ring', itemClass: 'Ring', ilvl: 1, tags: ['ring', 'default'] })
    const r = evaluateMethod(ring, data, { desired: [], method: { kind: 'anoint', notable: 'Whispers of Doom' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/amulet/i)
  })
  it('rejects an unseeded notable (flag, do not invent)', () => {
    const r = evaluateMethod(amulet(), data, { desired: [], method: { kind: 'anoint', notable: 'Not In Table' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/seed recipe table|explicitly/i)
  })
  it('rejects abstract (no notable, no oils)', () => {
    const r = evaluateMethod(amulet(), data, { desired: [], method: { kind: 'anoint' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/specific notable|supply 3 oils/i)
  })
  it('rejects a wrong oil count', () => {
    const r = evaluateMethod(amulet(), data, { desired: [], method: { kind: 'anoint', oils: ['Golden', 'Golden'] } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/exactly 3 oils/i)
  })
  it('rejects an unknown oil name', () => {
    const r = evaluateMethod(amulet(), data, { desired: [], method: { kind: 'anoint', oils: ['Golden', 'Golden', 'Plasma'] } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/unknown oil/i)
  })
})
