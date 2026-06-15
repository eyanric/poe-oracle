/**
 * services — Memory Strands (Tier-2, RESOURCE-CONDITIONED). The depleting-resource arity the v2
 * interface declared (`itemState.resources.memoryStrands` + `CraftModule.resourceConditioning`) but
 * nothing has exercised yet. This is the method that uses it for real — after it lands all three
 * interface shapes are proven (single-item, two-item combine, resource-conditioned). Core since 3.26.
 *
 * Mechanics (current 3.28; ⚠ magnitudes flagged — not in repoe-fork, caller-overridable constants):
 *  - Equipment from Memory-influenced maps carries Memory Strands (0–100), a property of the item.
 *  - Reforge/ADD currencies (alt/chaos/exalt/…) on a strand item: (1) bias the roll toward HIGHER
 *    tiers, and (2) DEPLETE strands per craft. Fossils/bench/metacrafts do NOT consume or boost.
 *  - Orb of Remembrance: randomise/add strands on a NORMAL item (replenish).
 *  - Orb of Unravelling: consume ALL strands to ATTEMPT tier upgrades (more strands → better odds).
 *    Post-3.26.0d this is genuine RNG — it can consume everything and upgrade NOTHING. Ignores
 *    "prefixes/suffixes cannot be changed"; cannot Elevate influenced mods.
 *  - Hinekora's Lock: NOT modelled (deprioritized).
 *
 * Clean-room; analysis/information only; manual-invoke.
 */
import { buildBaseModIndex, modRollProbability } from './modWeightIndex'
import { consumeResource, type ItemState } from './itemState'
import type { CraftModule, InputSet, CraftDataContext, ModuleParams, OutcomeDistribution, ResourceConditioning } from './craftModule'
import type { ExpectedAttemptsResult, PlanStepBlueprint } from './craftMethods'

export const STRAND_CAP = 100
/** ⚠ FLAGGED, caller-overridable (not in the export): tier-boost factor per strand. */
export const STRAND_BOOST_PER_STRAND = 0.01 // at 100 strands ⇒ ×2.0 weight on the desired (upward tier shift)
/** ⚠ FLAGGED: strands depleted per reforge/add craft. */
export const STRANDS_PER_CRAFT = 10
/** ⚠ FLAGGED: Orb of Unravelling per-strand chance to land a tier upgrade (whiff = none land). */
export const UNRAVEL_UPGRADE_CHANCE_PER_STRAND = 0.03
/** ⚠ FLAGGED: expected tier-upgrades per strand consumed by Orb of Unravelling. */
export const UNRAVEL_UPGRADE_EV_PER_STRAND = 0.02

const clampStrands = (s: number): number => Math.min(Math.max(s, 0), STRAND_CAP)
/** Tier-boost multiplier at a strand level (1 at 0 strands ⇒ reverts to the normal roll). */
export const strandBoost = (strands: number, perStrand = STRAND_BOOST_PER_STRAND): number => 1 + perStrand * clampStrands(strands)
/**
 * Reweight a base roll share by a tier-boost (exact pool-reweight of the desired mod's weight):
 * `(share·boost)/(1−share+share·boost)`. boost=1 ⇒ share; needs only the share, not the pool.
 */
export const conditionedShare = (share: number, boost: number): number =>
  share <= 0 ? 0 : (share * boost) / (1 - share + share * boost)

/**
 * Expected reforge/add attempts to hit the desired mod across a DEPLETING strand sequence: each
 * craft uses the boosted share at the current strand level, then depletes; once strands hit 0 the
 * tail runs at the base (un-boosted) share. Models the sequence, not a single roll.
 */
export function strandSequenceEV(baseShare: number, strands: number, perCraft = STRANDS_PER_CRAFT, perStrand = STRAND_BOOST_PER_STRAND): { expectedAttempts: number; boostedCrafts: number } {
  if (baseShare <= 0) return { expectedAttempts: Infinity, boostedCrafts: 0 }
  let cumFail = 1, e = 0
  for (let n = 1; n <= 100000; n++) {
    const s = Math.max(0, strands - (n - 1) * perCraft)
    const p = conditionedShare(baseShare, strandBoost(s, perStrand))
    e += n * cumFail * p
    cumFail *= 1 - p
    if (cumFail < 1e-12) break
    if (s === 0) { // strands exhausted ⇒ constant base rate ⇒ close the geometric tail
      e += cumFail * (n + 1 / baseShare)
      break
    }
  }
  return { expectedAttempts: e, boostedCrafts: Math.ceil(strands / perCraft) }
}

const unsupportedR = (method: string, reason: string): ExpectedAttemptsResult =>
  ({ method, supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] })

const FLAG_MAGNITUDES =
  '⚠ strand magnitudes (tier-boost/strand, strands/craft, unravel odds) are NOT in repoe-fork — flagged, caller-overridable constants.'

// ── 1. strand-craft (resource-conditioned reforge/add) ──────────────────────────

function evalStrandCraft(state: ItemState, data: CraftDataContext, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as { kind: 'strand-craft'; currency?: string; boostPerStrand?: number; strandsPerCraft?: number }
  const d = params.desired[0]
  if (!d || (!d.group && !d.modId)) return unsupportedR('strand-craft', 'name the specific desired mod (group or modId) — specificity is the product')
  const idx = buildBaseModIndex(state.base, state.itemClass, new Set(state.tags), state.ilvl, data.mods)
  const baseShare = modRollProbability(idx, { affix: d.slot, group: d.group, modId: d.modId })
  if (baseShare <= 0) return unsupportedR('strand-craft', `${d.label} cannot roll on this base/ilvl (weight 0)`)

  const strands = clampStrands(state.resources.memoryStrands ?? 0)
  const perStrand = method.boostPerStrand ?? STRAND_BOOST_PER_STRAND
  const perCraft = method.strandsPerCraft ?? STRANDS_PER_CRAFT
  const currency = method.currency ?? 'Chaos Orb'
  const boost = strandBoost(strands, perStrand)
  const p = conditionedShare(baseShare, boost)
  const attempts = 1 / p
  const seq = strandSequenceEV(baseShare, strands, perCraft, perStrand)

  return {
    method: `strand-craft (${currency})`, supported: true, expectedAttempts: attempts, perAttemptProb: p,
    consumables: [{ name: currency, qty: attempts, category: 'currency' }],
    lowConfidence: true,
    notes: [
      strands > 0
        ? `RESOURCE-CONDITIONED: ${strands} strands ⇒ ×${boost.toFixed(2)} tier-boost ⇒ P(${d.label}) ${(baseShare * 100).toFixed(1)}% → ${(p * 100).toFixed(1)}%.`
        : `0 strands ⇒ no boost: P(${d.label}) = base ${(baseShare * 100).toFixed(1)}% (reverts to the normal weight-index roll).`,
      `Depletes ${perCraft} strands/craft (clamp 0); the boost diminishes as strands deplete. Sequence EV from ${strands} strands ≈ ${seq.expectedAttempts.toFixed(1)} ${currency} (~${seq.boostedCrafts} boosted crafts) vs ${(1 / baseShare).toFixed(1)} un-stranded.`,
      'Only reforge/ADD currencies interact — fossils/bench/metacrafts pass through (no boost, no depletion).',
      FLAG_MAGNITUDES,
    ],
  }
}

const strandReweight = (perStrand: number): ResourceConditioning['reweight'] =>
  (dist: OutcomeDistribution, level: number): OutcomeDistribution => {
    if (!dist.outcomes.length) return dist
    const boost = strandBoost(level, perStrand)
    // The first outcome is the "hit"; boost its probability via the same pool-reweight, renormalise the rest.
    const [hit, ...rest] = dist.outcomes
    const newHit = conditionedShare(hit.p, boost)
    const restTotal = rest.reduce((s, o) => s + o.p, 0)
    const scale = restTotal > 0 ? (1 - newHit) / restTotal : 0
    return { outcomes: [{ ...hit, p: newHit }, ...rest.map(o => ({ ...o, p: o.p * scale }))], notes: [`reweighted by ${level} strands (×${boost.toFixed(2)})`] }
  }

const stepsFrom = (r: ExpectedAttemptsResult): PlanStepBlueprint[] => {
  if (!r.supported) return []
  if (r.perAttemptProb >= 1) return r.consumables.map(c => ({ kind: 'fixed', label: c.name, consumable: { name: c.name, category: c.category }, qty: c.qty }))
  return r.consumables.map(c => ({ kind: 'keep-trying', label: c.name, p: r.perAttemptProb, consumable: { name: c.name, category: c.category }, qty: 1 }))
}

export const strandCraftModule: CraftModule = {
  id: 'strand-craft', title: 'Strand-craft (memory-strand reforge)', arity: 1, respectsLocks: true,
  resourceConditioning: { resource: 'memoryStrands', consumes: STRANDS_PER_CRAFT, reweight: strandReweight(STRAND_BOOST_PER_STRAND) },
  evaluate: (inputs: InputSet, data, params) => evalStrandCraft(inputs[0], data, params),
  applicable: (inputs: InputSet, data, params) => { const r = evalStrandCraft(inputs[0], data, params); return { ok: r.supported, reason: r.reason } },
  outcomes: (inputs: InputSet, data, params): OutcomeDistribution => {
    const r = evalStrandCraft(inputs[0], data, params)
    if (!r.supported) return { outcomes: [{ p: 1, state: inputs[0] }], notes: [r.reason ?? 'unsupported'] }
    const depleted = consumeResource(inputs[0], 'memoryStrands', STRANDS_PER_CRAFT) // resource depletes per craft
    return { outcomes: [{ p: r.perAttemptProb, state: depleted }, { p: 1 - r.perAttemptProb, state: depleted }], notes: ['strands depleted on the output state'] }
  },
  cost: (inputs: InputSet, data, params) => { const r = evalStrandCraft(inputs[0], data, params); return { steps: stepsFrom(r), lowConfidence: r.lowConfidence } },
  toRiskSteps: (inputs: InputSet, data, params) => stepsFrom(evalStrandCraft(inputs[0], data, params)),
}

// ── 2. Orb of Remembrance (replenish strands on a normal item) ──────────────────

function evalRemembrance(state: ItemState): ExpectedAttemptsResult {
  if (state.rarity !== 'normal') return unsupportedR('remembrance', `Orb of Remembrance applies to a NORMAL item (rarity: ${state.rarity})`)
  return {
    method: 'Orb of Remembrance', supported: true, expectedAttempts: 1, perAttemptProb: 1,
    consumables: [{ name: 'Orb of Remembrance', qty: 1, category: 'currency' }],
    lowConfidence: true,
    notes: [`Randomises/adds Memory Strands (0–${STRAND_CAP}) on a normal item — replenishes the resource (deterministic action, random amount).`, FLAG_MAGNITUDES],
  }
}

// ── 3. Orb of Unravelling (consume-all-strands tier-upgrade gamble) ─────────────

function evalUnravelling(state: ItemState): ExpectedAttemptsResult {
  const strands = clampStrands(state.resources.memoryStrands ?? 0)
  if (strands <= 0) return unsupportedR('unravelling', 'no Memory Strands to consume')
  const whiff = Math.pow(1 - UNRAVEL_UPGRADE_CHANCE_PER_STRAND, strands)
  const expectedUpgrades = UNRAVEL_UPGRADE_EV_PER_STRAND * strands
  return {
    method: 'Orb of Unravelling', supported: true, expectedAttempts: 1, perAttemptProb: 1,
    consumables: [{ name: 'Orb of Unravelling', qty: 1, category: 'currency' }],
    lowConfidence: true,
    notes: [
      `Consumes ALL ${strands} strands to ATTEMPT tier upgrades: E≈${expectedUpgrades.toFixed(2)} upgrades; P(whiff = upgrade NOTHING) ≈ ${(whiff * 100).toFixed(0)}%.`,
      '⚠ Genuine RNG post-3.26.0d — can consume every strand and upgrade nothing (NOT the old infinite tier-up loop).',
      'Ignores "prefixes/suffixes cannot be changed" metamods; cannot Elevate influenced mods.',
      FLAG_MAGNITUDES,
    ],
  }
}

const arity1 = (id: string, title: string, evalFn: (state: ItemState) => ExpectedAttemptsResult): CraftModule => ({
  id, title, arity: 1, respectsLocks: true,
  evaluate: (inputs: InputSet) => evalFn(inputs[0]),
  applicable: (inputs: InputSet) => { const r = evalFn(inputs[0]); return { ok: r.supported, reason: r.reason } },
  outcomes: (inputs: InputSet): OutcomeDistribution => { const r = evalFn(inputs[0]); return { outcomes: [{ p: 1, state: inputs[0] }], notes: r.supported ? undefined : [r.reason ?? 'unsupported'] } },
  cost: (inputs: InputSet) => { const r = evalFn(inputs[0]); return { steps: stepsFrom(r), lowConfidence: r.lowConfidence } },
  toRiskSteps: (inputs: InputSet) => stepsFrom(evalFn(inputs[0])),
})

export const remembranceModule = arity1('remembrance', 'Orb of Remembrance (replenish strands)', evalRemembrance)
export const unravellingModule = arity1('unravelling', 'Orb of Unravelling (consume-all gamble)', evalUnravelling)
