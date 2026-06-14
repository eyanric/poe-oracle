import { describe, it, expect } from 'vitest'
import {
  makeRng,
  geomQuantileAttempts,
  costDistribution,
  determinism,
  brickPoints,
  riskProfile,
  type CraftPlan,
} from '../src/services/craftRisk'

// Plans spanning the spectrum -----------------------------------------------------
const essencePlan: CraftPlan = { label: 'essence', steps: [{ kind: 'fixed', label: 'Essence', cost: 3 }] }
const altSpamPlan: CraftPlan = {
  label: 'alt→regal',
  steps: [
    { kind: 'keep-trying', label: 'alt to mod', p: 0.2, costPerAttempt: 1 },
    { kind: 'fixed', label: 'Regal', cost: 1 },
  ],
}
const gamblePlan: CraftPlan = {
  label: 'expensive swing',
  steps: [{ kind: 'keep-trying', label: 'big roll', p: 0.5, costPerAttempt: 50 }],
}
// Synthetic unprotected exalt slam on a valuable base (for the brick machinery).
const slamPlan: CraftPlan = {
  label: 'unprotected slam',
  steps: [
    { kind: 'fixed', label: 'built base', cost: 100 },
    { kind: 'slam', label: 'Exalt slam', pSuccess: 0.2, cost: 5, recoverable: false },
  ],
}

describe('seeded RNG', () => {
  it('is reproducible for a given seed', () => {
    const a = makeRng(42), b = makeRng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('geomQuantileAttempts', () => {
  it('matches ceil(ln(1-q)/ln(1-p))', () => {
    expect(geomQuantileAttempts(0.2, 0.9)).toBe(11) // ln .1 / ln .8 ≈ 10.32
    expect(geomQuantileAttempts(0.2, 0.5)).toBe(4)
    expect(geomQuantileAttempts(1, 0.9)).toBe(1)
  })
  it('p90 ≈ 2.3× the mean for small p (sanity)', () => {
    const p = 0.02
    expect(geomQuantileAttempts(p, 0.9) / (1 / p)).toBeCloseTo(2.3, 1)
  })
})

describe('costDistribution', () => {
  it('point distribution for a fully deterministic plan', () => {
    const d = costDistribution(essencePlan)
    expect(d.method).toBe('point')
    expect([d.mean, d.p50, d.p90, d.p95]).toEqual([3, 3, 3, 3])
  })

  it('closed-form for a single geometric step + fixed terminal', () => {
    const d = costDistribution(altSpamPlan)
    expect(d.method).toBe('closed-form')
    expect(d.mean).toBeCloseTo(1 / 0.2 + 1, 6) // 6
    expect(d.p50).toBe(4 + 1) // 4 alts + regal
    expect(d.p90).toBe(11 + 1) // 11 alts + regal
    expect(d.p90).toBeGreaterThan(d.mean) // the tail is worse than the mean
  })

  it('Monte Carlo for brick plans, reproducible + ≈ analytic mean', () => {
    const a = costDistribution(slamPlan, { seed: 7, trials: 20000 })
    const b = costDistribution(slamPlan, { seed: 7, trials: 20000 })
    expect(a.method).toBe('monte-carlo')
    expect(a.p90).toBe(b.p90) // seeded → identical
    expect(a.mean).toBeGreaterThan(400) // analytic 525 (= 105 / 0.2)
    expect(a.mean).toBeLessThan(650)
    expect(a.p90).toBeGreaterThan(a.p50)
  })
})

describe('determinism', () => {
  it('1.0 for a fully guaranteed craft (essence)', () => {
    expect(determinism(essencePlan).score).toBe(1)
  })
  it('low for a grind (most cost is the variable step)', () => {
    const d = determinism(altSpamPlan)
    expect(d.score).toBeCloseTo(1 / 6, 2) // regal 1 of total 6
    expect(d.brickPenalty).toBe(0)
  })
  it('pushed toward 0 by brick presence', () => {
    const d = determinism(slamPlan)
    expect(d.brickPenalty).toBeCloseTo(0.8, 6) // 1 - pSuccess
    expect(d.score).toBeLessThan(0.25)
  })
})

describe('brickPoints', () => {
  it('reports failure prob + value-at-risk for unrecoverable steps', () => {
    const b = brickPoints(slamPlan)
    expect(b).toHaveLength(1)
    expect(b[0].failureProb).toBeCloseTo(0.8, 6)
    expect(b[0].valueAtRisk).toBe(105) // built base 100 + slam 5
  })
  it('no brick points for recoverable-only plans', () => {
    expect(brickPoints(altSpamPlan)).toHaveLength(0)
  })
})

describe('riskProfile — category across the spectrum', () => {
  it('essence → deterministic', () => {
    expect(riskProfile(essencePlan).category).toBe('deterministic')
  })
  it('alt-spam → grind (bounded downside, no brick)', () => {
    const r = riskProfile(altSpamPlan)
    expect(r.category).toBe('grind')
    expect(r.bricks).toHaveLength(0)
    expect(r.distribution.p90).toBeGreaterThan(r.distribution.mean)
  })
  it('expensive single swing → gamble', () => {
    expect(riskProfile(gamblePlan).category).toBe('gamble')
  })
  it('unprotected slam → high-brick with value-at-risk', () => {
    const r = riskProfile(slamPlan, { seed: 1, trials: 5000 })
    expect(r.category).toBe('high-brick')
    expect(r.bricks[0].valueAtRisk).toBe(105)
    expect(r.notes.join(' ')).toMatch(/brick/)
  })
})
