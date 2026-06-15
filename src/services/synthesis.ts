/**
 * services — Synthesis (Tier-2). CORRECTED mechanic: the league Synthesiser (Memory Nexus)
 * fractured-item FUSION is GONE — that was the Synthesis-league method, not how synthesised gear
 * is made in core. Current core Synthesis is arity-1:
 *   1. Harvest "synthesise" transform (Namharim recipe) — non-influenced/non-fractured item →
 *      synthesised base + N random synthesis implicits (existing implicits removed).
 *   2. Beast (Vivid Vulture) reroll — rerolls ONE synthesis implicit → keep-trying for the desired.
 *
 * ⚠ DATA GAP (flag-don't-invent): the synthesised-item IMPLICIT POOL is NOT in the repoe-fork export.
 * The `synthesis_a` / `synthesis_globals` / `synthesis_bonus` domains are Synthesis MAP / Memory-Nexus
 * mods (e.g. "increased number of Rare Monsters"), NOT gear implicits — and there is no item-implicit
 * synthesis generation_type or file. So `P(desired implicit) = weight/pool` CANNOT be resolved from the
 * data; the per-base synthesis implicit list must be sourced from poedb. The Beast-reroll module models
 * the keep-trying STRUCTURE with a flagged caller-supplied pool size; the synthesise TRANSFORM (cost +
 * eligibility + count rule) is fully modelled and priced live (lifeforce).
 *
 * Clean-room; analysis/information only; manual-invoke.
 */
import type { ItemState } from './itemState'
import { isInfluenced } from './eldritch'
import type { CraftModule, InputSet, CraftDataContext, ModuleParams, OutcomeDistribution } from './craftModule'
import type { ExpectedAttemptsResult, PlanStepBlueprint } from './craftMethods'

/** ⚠ SOURCED (PoE wiki) — Namharim "synthesise" Harvest recipe cost. Verify against the live game. */
export const SYNTHESISE_COST = { vivid: 5000, sacred: 1 }
/** ⚠ DATAMINED (Harvest league) implicit-count distribution — flagged; verify current. */
export const IMPLICIT_COUNT_DIST: Record<number, number> = { 1: 0.75, 2: 0.19, 3: 0.06 }
export const expectedImplicitCount = Object.entries(IMPLICIT_COUNT_DIST).reduce((s, [n, p]) => s + Number(n) * p, 0)

/** Input eligibility for the synthesise transform: non-influenced / non-fractured / non-corrupted. */
export function synthesiseEligibility(s: ItemState): { ok: boolean; reason?: string } {
  if (isInfluenced(s)) return { ok: false, reason: `cannot synthesise an influenced item (${s.influence.join(', ')})` }
  if (s.fractured.length) return { ok: false, reason: 'cannot synthesise a fractured item' }
  if (s.corrupted) return { ok: false, reason: 'cannot synthesise a corrupted item' }
  return { ok: true } // unique exclusion noted (uniques aren't representable in ItemState rarity)
}

const unsupportedR = (method: string, reason: string): ExpectedAttemptsResult =>
  ({ method, supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] })

const POOL_GAP_NOTE =
  '⚠ the synthesis implicit POOL is NOT in the repoe-fork export (the synthesis_* domains are MAP/Memory ' +
  'mods, not gear implicits) — which implicits roll + their weights must be sourced from poedb.'

// ── Harvest "synthesise" transform (arity 1, deterministic) ─────────────────────

function evalSynthesise(state: ItemState): ExpectedAttemptsResult {
  const elig = synthesiseEligibility(state)
  if (!elig.ok) return unsupportedR('synthesise', elig.reason!)
  return {
    method: 'synthesise (Harvest)', supported: true, expectedAttempts: 1, perAttemptProb: 1,
    consumables: [
      { name: 'Vivid Crystallised Lifeforce', qty: SYNTHESISE_COST.vivid, category: 'currency' },
      { name: 'Sacred Crystallised Lifeforce', qty: SYNTHESISE_COST.sacred, category: 'currency' },
    ],
    lowConfidence: true,
    notes: [
      `Harvest synthesise (Namharim recipe): → synthesised base + random synthesis implicit(s); existing implicits removed. Deterministic transform (P=1).`,
      `⚠ implicit COUNT (datamined Harvest league): 75% → 1 · 19% → 2 · 6% → 3 (E≈${expectedImplicitCount.toFixed(2)}) — flagged, verify current.`,
      `⚠ cost ${SYNTHESISE_COST.vivid} Vivid + ${SYNTHESISE_COST.sacred} Sacred Crystallised Lifeforce (sourced; verify current).`,
      `eldritch ⊥ synthesis: eldritch currency works but DELETES the synthesis implicits. Synthesised items cannot be influenced / fractured / Chanced to unique.`,
      POOL_GAP_NOTE,
    ],
  }
}

// ── Beast (Vivid Vulture) reroll (arity 1, keep-trying) ─────────────────────────

function evalReroll(state: ItemState, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as { kind: 'synthesis-reroll'; poolSize?: number }
  const d = params.desired[0]
  if (!d || (!d.group && !d.modId)) return unsupportedR('synthesis-reroll', 'name the specific synthesis implicit (group or modId), not "any" — specificity is the product')
  if (!method.poolSize || method.poolSize < 1) {
    return unsupportedR('synthesis-reroll', `${POOL_GAP_NOTE} Supply poolSize (the # of synthesis implicits rollable on this base) to cost the reroll.`)
  }
  const p = 1 / method.poolSize // ⚠ uniform approximation — real weights unavailable (pool not in export)
  const attempts = 1 / p
  return {
    method: 'synthesis-reroll (Vivid Vulture)', supported: true, expectedAttempts: attempts, perAttemptProb: p,
    consumables: [{ name: 'Vivid Vulture', qty: attempts, category: 'beast' }],
    lowConfidence: true,
    notes: [
      `Beast (Vivid Vulture) rerolls ONE synthesis implicit → keep-trying for ${d.label}. P = 1/${method.poolSize} = ${(p * 100).toFixed(1)}% (⚠ UNIFORM approximation — real spawn weights unavailable).`,
      POOL_GAP_NOTE,
      `⚠ Vivid Vulture is a beast (not in the price feed) — supply a manual price; expected ~${attempts.toFixed(1)} vultures.`,
    ],
    // manual-price hook surfaced via the module cost() below
  }
}

// ── Module wrappers ──────────────────────────────────────────────────────────────

const outcomesFrom = (state: ItemState, r: ExpectedAttemptsResult): OutcomeDistribution =>
  r.supported
    ? { outcomes: r.perAttemptProb >= 1 ? [{ p: 1, state }] : [{ p: r.perAttemptProb, state }, { p: 1 - r.perAttemptProb, state }] }
    : { outcomes: [{ p: 1, state }], notes: [r.reason ?? 'unsupported'] }

const stepsFrom = (r: ExpectedAttemptsResult): PlanStepBlueprint[] => {
  if (!r.supported) return []
  if (r.perAttemptProb >= 1) return r.consumables.map(c => ({ kind: 'fixed', label: c.name, consumable: { name: c.name, category: c.category }, qty: c.qty }))
  return r.consumables.map(c => ({ kind: 'keep-trying', label: c.name, p: r.perAttemptProb, consumable: { name: c.name, category: c.category }, qty: 1 }))
}

const arity1 = (
  id: string, title: string,
  evalFn: (state: ItemState, data: CraftDataContext, params: ModuleParams) => ExpectedAttemptsResult,
  manualPriceHooks: string[] = [],
): CraftModule => ({
  id, title, arity: 1, respectsLocks: true,
  evaluate: (inputs: InputSet, data, params) => evalFn(inputs[0], data, params),
  applicable: (inputs: InputSet, data, params) => { const r = evalFn(inputs[0], data, params); return { ok: r.supported, reason: r.reason } },
  outcomes: (inputs: InputSet, data, params) => outcomesFrom(inputs[0], evalFn(inputs[0], data, params)),
  cost: (inputs: InputSet, data, params) => { const r = evalFn(inputs[0], data, params); return { steps: stepsFrom(r), lowConfidence: r.lowConfidence, manualPriceHooks } },
  toRiskSteps: (inputs: InputSet, data, params) => stepsFrom(evalFn(inputs[0], data, params)),
})

export const synthesiseModule = arity1('synthesise', 'Synthesise (Harvest transform)', (state) => evalSynthesise(state))
export const synthesisRerollModule = arity1('synthesis-reroll', 'Synthesis reroll (Vivid Vulture)', (state, _data, params) => evalReroll(state, params), ['Vivid Vulture'])
