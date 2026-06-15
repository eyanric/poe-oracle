import { describe, it, expect } from 'vitest'
import { synthesiseEligibility, IMPLICIT_COUNT_DIST, expectedImplicitCount, SYNTHESISE_COST } from '../src/services/synthesis'
import { evaluateMethod } from '../src/services/craftMethods'
import { newItemState } from '../src/services/itemState'

const data = { mods: {}, currentLeague: 'Mirage' }
const ring = (over = {}) => newItemState({ base: 'Two-Stone Ring', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'], ...over })

describe('synthesis constants (sourced/flagged)', () => {
  it('implicit-count distribution sums to 1 and E≈1.31', () => {
    expect(Object.values(IMPLICIT_COUNT_DIST).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 6)
    expect(expectedImplicitCount).toBeCloseTo(1.31, 2)
  })
  it('synthesise cost = 5000 Vivid + 1 Sacred', () => {
    expect(SYNTHESISE_COST).toEqual({ vivid: 5000, sacred: 1 })
  })
})

describe('synthesiseEligibility', () => {
  it('accepts a clean non-influenced/non-fractured item', () => {
    expect(synthesiseEligibility(ring()).ok).toBe(true)
  })
  it('rejects influenced / fractured / corrupted inputs', () => {
    expect(synthesiseEligibility(ring({ influence: ['shaper'] })).ok).toBe(false)
    expect(synthesiseEligibility(ring({ fractured: ['x'] })).ok).toBe(false)
    expect(synthesiseEligibility(ring({ corrupted: true })).ok).toBe(false)
  })
})

describe('synthesise module (Harvest transform)', () => {
  it('is deterministic and consumes lifeforce', () => {
    const r = evaluateMethod(ring(), data, { desired: [], method: { kind: 'synthesise' } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBe(1)
    expect(r.consumables).toEqual([
      { name: 'Vivid Crystallised Lifeforce', qty: 5000, category: 'currency' },
      { name: 'Sacred Crystallised Lifeforce', qty: 1, category: 'currency' },
    ])
    expect(r.notes.join(' ')).toMatch(/POOL is NOT in the repoe-fork export/i) // data-gap flagged
  })
  it('rejects an influenced input', () => {
    const r = evaluateMethod(ring({ influence: ['elder'] }), data, { desired: [], method: { kind: 'synthesise' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/influenced/i)
  })
})

describe('synthesis-reroll module (Vivid Vulture)', () => {
  const desired = [{ slot: 'prefix' as const, group: 'SynthImplicit', label: 'a synthesis implicit' }]
  it('without poolSize is unsupported (pool not in export)', () => {
    const r = evaluateMethod(ring(), data, { desired, method: { kind: 'synthesis-reroll' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/POOL is NOT in the repoe-fork export|poolSize/i)
  })
  it('with poolSize models the keep-trying loop (uniform 1/N, flagged)', () => {
    const r = evaluateMethod(ring(), data, { desired, method: { kind: 'synthesis-reroll', poolSize: 20 } })
    expect(r.supported).toBe(true)
    expect(r.perAttemptProb).toBeCloseTo(1 / 20, 6)
    expect(r.consumables[0].name).toBe('Vivid Vulture')
    expect(r.consumables[0].qty).toBeCloseTo(20, 6)
  })
  it('rejects an abstract target', () => {
    const r = evaluateMethod(ring(), data, { desired: [{ slot: 'prefix', label: 'any' }], method: { kind: 'synthesis-reroll', poolSize: 20 } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/specific/i)
  })
})
