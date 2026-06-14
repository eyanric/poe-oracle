import { describe, it, expect } from 'vitest'
import { evaluateLadder, type LadderRungSpec } from '../src/services/ladderCost'

describe('evaluateLadder', () => {
  it('a production rung is just its unit cost', () => {
    const r = evaluateLadder([{ label: 'donor', pSuccess: 1, baseProductionChaos: 5 }])
    expect(r.totalChaos).toBe(5)
    expect(r.expectedUnitsConsumed).toEqual([1])
  })

  it('failure-reproduction: cost = (inputs + own) / p, inputs reproduced each attempt', () => {
    // rung0 donor = 5c; rung1 consumes 2 donors + 10c recomb, p=0.5
    const ladder: LadderRungSpec[] = [
      { label: 'donor', pSuccess: 1, baseProductionChaos: 5 },
      { label: 'combine', pSuccess: 0.5, recombCostChaos: 10, inputs: [{ fromRung: 0, count: 2 }] },
    ]
    const r = evaluateLadder(ladder)
    // costPerUnit[1] = (2*5 + 10) / 0.5 = 40
    expect(r.totalChaos).toBe(40)
    // expected donors consumed = 2 per attempt × (1/0.5) attempts = 4
    expect(r.expectedUnitsConsumed[0]).toBe(4)
    expect(r.rungs[1].expectedAttemptsPerUnit).toBe(2)
  })

  it('per-rung own-cost contributions sum to the total', () => {
    const ladder: LadderRungSpec[] = [
      { label: 'r0', pSuccess: 1, baseProductionChaos: 3 },
      { label: 'r1', pSuccess: 0.4, recombCostChaos: 2, extraCostChaos: 1, inputs: [{ fromRung: 0, count: 2 }] },
      { label: 'r2', pSuccess: 0.25, recombCostChaos: 5, inputs: [{ fromRung: 1, count: 2 }] },
    ]
    const r = evaluateLadder(ladder)
    const sum = r.rungs.reduce((s, x) => s + x.contribution, 0)
    expect(sum).toBeCloseTo(r.totalChaos, 6)
  })

  it('cascades donor counts through 3 rungs', () => {
    const ladder: LadderRungSpec[] = [
      { label: 'r0', pSuccess: 1, baseProductionChaos: 1 },
      { label: 'r1', pSuccess: 0.5, inputs: [{ fromRung: 0, count: 2 }] },
      { label: 'r2', pSuccess: 0.5, inputs: [{ fromRung: 1, count: 2 }] },
    ]
    const r = evaluateLadder(ladder)
    // r2:1 → r1 = 1/0.5*2 = 4 → r0 = 4/0.5*2 = 16
    expect(r.expectedUnitsConsumed[1]).toBe(4)
    expect(r.expectedUnitsConsumed[0]).toBe(16)
  })
})
