/**
 * services — craft RISK profile (cost distribution, not just EV).
 *
 * A craft's cost is a distribution, not a point. This turns a priced CraftPlan (a
 * sequence of steps with chaos costs) into: a cost distribution (p50/p90/p95), a
 * determinism score with its inputs exposed, brick-point detection with value-at-risk,
 * and a one-line risk category. Pure + seeded-RNG so Monte Carlo is reproducible.
 *
 * Foundational: the current methods map to keep-trying + fixed steps (no bricks); the
 * `slam` step type + Monte Carlo restart-on-brick are built/validated here for the
 * future slam/annul methods, without adding those methods to calc_craft_cost.
 */

// ── Plan ──────────────────────────────────────────────────────────────────────

/** Repeat until success at prob `p` (geometric); each attempt costs `costPerAttempt`. */
export interface KeepTryingStep {
  kind: 'keep-trying'
  label: string
  p: number
  costPerAttempt: number
}
/** A guaranteed one-off cost (regal, bench craft, the essence itself). */
export interface FixedStep {
  kind: 'fixed'
  label: string
  cost: number
}
/**
 * A single high-variance attempt at prob `pSuccess`. If `recoverable`, a miss is just
 * retried (cheap). If not, a miss BRICKS — the value built so far is lost and the craft
 * restarts (unprotected exalt slam, annul, divine-ruin).
 */
export interface SlamStep {
  kind: 'slam'
  label: string
  pSuccess: number
  cost: number
  recoverable: boolean
}
export type CraftStep = KeepTryingStep | FixedStep | SlamStep
export interface CraftPlan {
  label: string
  steps: CraftStep[]
}

// ── Seeded RNG (mulberry32) ───────────────────────────────────────────────────

export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Inverse-CDF geometric sample: number of attempts until first success at prob p (≥1). */
function geomSample(p: number, rng: () => number): number {
  if (p >= 1) return 1
  if (p <= 0) return Infinity
  const u = rng()
  return Math.max(1, Math.ceil(Math.log(1 - u) / Math.log(1 - p)))
}

// ── Distribution ──────────────────────────────────────────────────────────────

export interface CostDistribution {
  mean: number
  p50: number
  p90: number
  p95: number
  method: 'point' | 'closed-form' | 'monte-carlo'
  trials?: number
}

const fixedSum = (plan: CraftPlan) =>
  plan.steps.filter((s): s is FixedStep => s.kind === 'fixed').reduce((a, s) => a + s.cost, 0)

/** Attempts needed to reach cumulative prob `q` for a geometric(p): ceil(ln(1-q)/ln(1-p)). */
export function geomQuantileAttempts(p: number, q: number): number {
  if (p >= 1) return 1
  if (p <= 0) return Infinity
  return Math.max(1, Math.ceil(Math.log(1 - q) / Math.log(1 - p)))
}

/** EV cost of a single step. */
function stepMean(s: CraftStep): number {
  if (s.kind === 'fixed') return s.cost
  if (s.kind === 'keep-trying') return s.p > 0 ? s.costPerAttempt / s.p : Infinity
  return s.recoverable ? (s.pSuccess > 0 ? s.cost / s.pSuccess : Infinity) : s.cost
}

export function planMean(plan: CraftPlan): number {
  // Unrecoverable bricks inflate the whole plan: each full pass succeeds with Π pSuccess,
  // so expected passes = 1/Πp; the recoverable + fixed costs repeat per pass too.
  const passSuccess = plan.steps
    .filter((s): s is SlamStep => s.kind === 'slam' && !s.recoverable)
    .reduce((a, s) => a * s.pSuccess, 1)
  const perPass = plan.steps.reduce((a, s) => a + (s.kind === 'slam' && !s.recoverable ? s.cost : stepMean(s)), 0)
  return passSuccess > 0 ? perPass / passSuccess : Infinity
}

const hasBrick = (plan: CraftPlan) => plan.steps.some(s => s.kind === 'slam' && !s.recoverable)
const keepTrying = (plan: CraftPlan) => plan.steps.filter((s): s is KeepTryingStep => s.kind === 'keep-trying')

/** Run one full craft to completion (restart on unrecoverable brick), returning total cost. */
function simulateOnce(plan: CraftPlan, rng: () => number): number {
  let total = 0
  for (let guard = 0; guard < 100_000; guard++) {
    let runCost = 0
    let bricked = false
    for (const s of plan.steps) {
      if (s.kind === 'fixed') runCost += s.cost
      else if (s.kind === 'keep-trying') runCost += geomSample(s.p, rng) * s.costPerAttempt
      else if (s.recoverable) runCost += geomSample(s.pSuccess, rng) * s.cost
      else {
        runCost += s.cost
        if (rng() >= s.pSuccess) { bricked = true; break } // miss → brick, lose this run
      }
    }
    total += runCost
    if (!bricked) return total
  }
  return total
}

export function costDistribution(plan: CraftPlan, opts: { seed?: number; trials?: number } = {}): CostDistribution {
  const kt = keepTrying(plan)
  // Point: everything guaranteed.
  if (kt.length === 0 && !hasBrick(plan)) {
    const c = fixedSum(plan)
    return { mean: c, p50: c, p90: c, p95: c, method: 'point' }
  }
  // Closed-form: exactly one geometric step + fixed terminals, no bricks.
  if (kt.length === 1 && !hasBrick(plan)) {
    const { p, costPerAttempt } = kt[0]
    const base = fixedSum(plan)
    const at = (q: number) => base + geomQuantileAttempts(p, q) * costPerAttempt
    return { mean: planMean(plan), p50: at(0.5), p90: at(0.9), p95: at(0.95), method: 'closed-form' }
  }
  // Monte Carlo: compound sequences / bricks.
  const trials = opts.trials ?? 10_000
  const rng = makeRng(opts.seed ?? 0x9e3779b9)
  const costs = new Array<number>(trials)
  for (let i = 0; i < trials; i++) costs[i] = simulateOnce(plan, rng)
  costs.sort((a, b) => a - b)
  const pct = (q: number) => costs[Math.min(trials - 1, Math.floor(q * trials))]
  return { mean: costs.reduce((a, b) => a + b, 0) / trials, p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), method: 'monte-carlo', trials }
}

// ── Determinism + bricks ──────────────────────────────────────────────────────

export interface BrickPoint {
  label: string
  failureProb: number
  /** Invested cost lost if this step bricks (EV of prior steps + this step's cost). */
  valueAtRisk: number
}

export interface DeterminismBreakdown {
  /** 1 = fully deterministic, 0 = pure gamble. */
  score: number
  guaranteedCost: number
  probabilisticCost: number
  /** P(at least one brick on a single pass). */
  brickPenalty: number
}

export type RiskCategory = 'deterministic' | 'grind' | 'gamble' | 'high-brick'

export interface RiskProfile {
  distribution: CostDistribution
  determinism: DeterminismBreakdown
  bricks: BrickPoint[]
  category: RiskCategory
  notes: string[]
}

export function brickPoints(plan: CraftPlan): BrickPoint[] {
  const out: BrickPoint[] = []
  let priorEv = 0
  for (const s of plan.steps) {
    if (s.kind === 'slam' && !s.recoverable) {
      out.push({ label: s.label, failureProb: 1 - s.pSuccess, valueAtRisk: priorEv + s.cost })
    }
    priorEv += stepMean(s)
  }
  return out
}

export function determinism(plan: CraftPlan): DeterminismBreakdown {
  let guaranteed = 0
  let probabilistic = 0
  for (const s of plan.steps) {
    if (s.kind === 'fixed') guaranteed += s.cost
    else probabilistic += stepMean(s)
  }
  const total = guaranteed + probabilistic
  const brickPenalty = 1 - plan.steps
    .filter((s): s is SlamStep => s.kind === 'slam' && !s.recoverable)
    .reduce((a, s) => a * s.pSuccess, 1)
  const share = total > 0 ? guaranteed / total : 1
  return { score: Number((share * (1 - brickPenalty)).toFixed(3)), guaranteedCost: guaranteed, probabilisticCost: probabilistic, brickPenalty }
}

export function riskProfile(plan: CraftPlan, opts: { seed?: number; trials?: number } = {}): RiskProfile {
  const distribution = costDistribution(plan, opts)
  const det = determinism(plan)
  const bricks = brickPoints(plan)
  const notes: string[] = []

  // Category.
  const materialBrick = bricks.some(b => b.failureProb >= 0.05 && b.valueAtRisk > 0)
  let category: RiskCategory
  if (materialBrick) {
    category = 'high-brick'
    notes.push(`unrecoverable step(s): ${bricks.map(b => `${b.label} ${(b.failureProb * 100).toFixed(0)}% brick, risking ${b.valueAtRisk.toFixed(0)}c`).join('; ')}`)
  } else if (det.score >= 0.85) {
    category = 'deterministic'
  } else {
    // Variance present, no brick: grind (many cheap tries) vs gamble (few expensive swings).
    const mean = distribution.mean || 1
    const maxAttemptCost = Math.max(0, ...keepTrying(plan).map(s => s.costPerAttempt))
    category = maxAttemptCost >= 0.25 * mean ? 'gamble' : 'grind'
  }
  if (distribution.mean > 0) {
    notes.push(`p90 is ${(distribution.p90 / distribution.mean).toFixed(1)}× the mean — budget for the unlucky tail.`)
  }
  return { distribution, determinism: det, bricks, category, notes }
}
