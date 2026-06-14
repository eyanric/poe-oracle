/**
 * services — multi-stage ladder cost with failure-reproduction (solver primitive).
 *
 * Evaluates the expected cost of a FIXED sequence of crafting stages where each stage's
 * inputs are produced by lower stages, and a failed attempt CONSUMES (destroys) its inputs
 * — so they must be reproduced. This is the cost function the future path solver calls;
 * it does NOT search for the ladder.
 *
 * Per-rung expected cost (bottom-up):
 *   rung 0 (production): costPerUnit = baseProductionChaos.
 *   rung N: costPerUnit = (Σ input.count·cost[input.fromRung] + recomb + extra) / pSuccess.
 * Expected lower-rung units consumed for ONE final (top-down): unitsProduced/pSuccess × count.
 *
 * ⚠ UPPER BOUND: this assumes a failed attempt loses ALL its inputs. In reality a failed
 * recombine often still carries desired mods and can be re-padded and re-smashed, so the
 * true cost is LOWER. Label totals an upper bound; partial-salvage is a future refinement.
 */

export interface LadderInputRef {
  /** Index of the lower rung that supplies this input. */
  fromRung: number
  /** How many of that rung's units are consumed per attempt at this rung. */
  count: number
}

export interface LadderRungSpec {
  label: string
  /** P(success) of one attempt at this rung. Production rungs use 1. */
  pSuccess: number
  /** Per-attempt recombinator/currency cost (chaos). */
  recombCostChaos?: number
  /** Per-attempt extra cost (e.g. NNN slam-padding: bench-block + slam) (chaos). */
  extraCostChaos?: number
  /** Lower-rung inputs consumed per attempt. Empty/undefined ⇒ a production rung. */
  inputs?: LadderInputRef[]
  /** Cost per unit for a production rung (rung 0; e.g. an alt→regal single-mod donor). */
  baseProductionChaos?: number
}

export interface LadderRungResult {
  index: number
  label: string
  pSuccess: number
  costPerUnit: number
  expectedAttemptsPerUnit: number
  /** Expected units of THIS rung produced for one final. */
  unitsProduced: number
  /** This rung's OWN-cost share of the grand total (recomb+extra, or rung-0 production). */
  contribution: number
}

export interface LadderResult {
  rungs: LadderRungResult[]
  /** Total expected cost of ONE final unit (the top rung) — an UPPER BOUND (see header). */
  totalChaos: number
  /** Expected units of each rung consumed/produced to make one final (index → count). */
  expectedUnitsConsumed: number[]
}

/** Evaluate a fixed ladder. The top rung (last) is the final product. */
export function evaluateLadder(rungs: LadderRungSpec[]): LadderResult {
  const cost: number[] = []
  const ownPerUnit: number[] = []
  for (let i = 0; i < rungs.length; i++) {
    const r = rungs[i]
    if (!r.inputs || r.inputs.length === 0) {
      cost[i] = r.baseProductionChaos ?? 0
      ownPerUnit[i] = cost[i]
      continue
    }
    const inputCost = r.inputs.reduce((s, inp) => s + inp.count * (cost[inp.fromRung] ?? 0), 0)
    const own = (r.recombCostChaos ?? 0) + (r.extraCostChaos ?? 0)
    const p = r.pSuccess > 0 ? r.pSuccess : Number.EPSILON
    cost[i] = (inputCost + own) / p
    ownPerUnit[i] = own / p
  }

  const top = rungs.length - 1
  const units = new Array(rungs.length).fill(0)
  units[top] = 1
  for (let i = top; i >= 0; i--) {
    const r = rungs[i]
    if (!r.inputs) continue
    const p = r.pSuccess > 0 ? r.pSuccess : Number.EPSILON
    const attempts = units[i] / p
    for (const inp of r.inputs) units[inp.fromRung] += attempts * inp.count
  }

  const results: LadderRungResult[] = rungs.map((r, i) => {
    const p = (!r.inputs || r.inputs.length === 0) ? 1 : (r.pSuccess > 0 ? r.pSuccess : Number.EPSILON)
    return {
      index: i, label: r.label, pSuccess: p,
      costPerUnit: cost[i], expectedAttemptsPerUnit: 1 / p,
      unitsProduced: units[i], contribution: units[i] * ownPerUnit[i],
    }
  })
  return { rungs: results, totalChaos: cost[top], expectedUnitsConsumed: units }
}
