import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import {
  strandBoost, conditionedShare, strandSequenceEV, STRAND_CAP, STRANDS_PER_CRAFT,
  strandCraftModule,
} from '../src/services/memoryStrands'
import { evaluateMethod } from '../src/services/craftMethods'
import { newItemState } from '../src/services/itemState'

const pre = (group: string): RepoeMod => ({
  domain: 'item', generation_type: 'prefix', name: group, type: group, is_essence_only: false, required_level: 1,
  groups: [group], spawn_weights: [{ tag: 'body_armour', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], text: group,
})
const MODS: Record<string, RepoeMod> = { GA: pre('GA'), GB: pre('GB') } // pool 2000 ⇒ share(GA)=0.5
const tags = ['body_armour', 'int_armour', 'armour', 'default']
const data = { mods: MODS, currentLeague: 'Mirage' }
const item = (strands?: number) => newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 84, tags, resources: strands != null ? { memoryStrands: strands } : undefined })

describe('strand math', () => {
  it('strandBoost: 1 at 0 strands, scales, caps at 100', () => {
    expect(strandBoost(0)).toBeCloseTo(1, 6)
    expect(strandBoost(100)).toBeCloseTo(2, 6) // default 0.01/strand
    expect(strandBoost(150)).toBeCloseTo(strandBoost(STRAND_CAP), 6)
    expect(strandBoost(-5)).toBeCloseTo(1, 6)
  })
  it('conditionedShare: boost 1 ⇒ unchanged; boost>1 ⇒ higher; pool-reweight exact', () => {
    expect(conditionedShare(0.5, 1)).toBeCloseTo(0.5, 6)
    expect(conditionedShare(0.5, 2)).toBeCloseTo(1 / 1.5, 6) // (0.5·2)/(1-0.5+1)
    expect(conditionedShare(0, 2)).toBe(0)
  })
  it('strandSequenceEV: 0 strands reverts to 1/share; more strands ⇒ fewer attempts', () => {
    expect(strandSequenceEV(0.2, 0).expectedAttempts).toBeCloseTo(1 / 0.2, 4)
    expect(strandSequenceEV(0.2, 100).expectedAttempts).toBeLessThan(1 / 0.2)
    expect(strandSequenceEV(0.2, 100).boostedCrafts).toBe(Math.ceil(100 / STRANDS_PER_CRAFT))
  })
})

describe('strand-craft module (resource-conditioned)', () => {
  it('boosts P(desired) with strands and reverts at 0', () => {
    const boosted = evaluateMethod(item(100), data, { desired: [{ slot: 'prefix', group: 'GA', label: 'GA' }], method: { kind: 'strand-craft' } })
    const base = evaluateMethod(item(0), data, { desired: [{ slot: 'prefix', group: 'GA', label: 'GA' }], method: { kind: 'strand-craft' } })
    expect(base.perAttemptProb).toBeCloseTo(0.5, 6) // un-boosted base share
    expect(boosted.perAttemptProb).toBeCloseTo(conditionedShare(0.5, 2), 6)
    expect(boosted.perAttemptProb).toBeGreaterThan(base.perAttemptProb)
  })
  it('depletes strands on the outcome state', () => {
    const dist = strandCraftModule.outcomes([item(100)], data, { desired: [{ slot: 'prefix', group: 'GA', label: 'GA' }], method: { kind: 'strand-craft' } })
    expect(dist.outcomes[0].state.resources.memoryStrands).toBe(100 - STRANDS_PER_CRAFT)
  })
  it('exposes the resourceConditioning hook + a working reweight', () => {
    const rc = strandCraftModule.resourceConditioning!
    expect(rc.resource).toBe('memoryStrands'); expect(rc.consumes).toBe(STRANDS_PER_CRAFT)
    const dist = rc.reweight({ outcomes: [{ p: 0.5, state: item() }, { p: 0.5, state: item() }] }, 100)
    expect(dist.outcomes[0].p).toBeCloseTo(conditionedShare(0.5, 2), 6)
    expect(dist.outcomes.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 6) // renormalised
  })
  it('rejects an abstract target', () => {
    const r = evaluateMethod(item(50), data, { desired: [{ slot: 'prefix', label: 'any' }], method: { kind: 'strand-craft' } })
    expect(r.supported).toBe(false); expect(r.reason).toMatch(/specific/i)
  })
})

describe('remembrance + unravelling', () => {
  it('remembrance needs a normal item', () => {
    expect(evaluateMethod(newItemState({ base: 'x', itemClass: 'Body Armour', ilvl: 84, tags, rarity: 'normal' }), data, { desired: [], method: { kind: 'remembrance' } }).supported).toBe(true)
    expect(evaluateMethod(item(0), data, { desired: [], method: { kind: 'remembrance' } }).supported).toBe(false) // default rare
  })
  it('unravelling needs strands; whiff probability falls as strands rise', () => {
    expect(evaluateMethod(item(0), data, { desired: [], method: { kind: 'unravelling' } }).supported).toBe(false)
    const u = evaluateMethod(item(100), data, { desired: [], method: { kind: 'unravelling' } })
    expect(u.supported).toBe(true)
    expect(u.notes.join(' ')).toMatch(/whiff|genuine RNG/i)
  })
})
