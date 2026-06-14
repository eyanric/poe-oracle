/**
 * services — Influence crafting (second Tier-1 coverage module).
 *
 * Reuses all three prior pieces: the resolved-weight machinery (`effectiveWeight`) on the
 * influence-gated pools; the arity-2 input channel (`evaluateInputs([a,b])`) for Awakener's Orb;
 * and the shared `isInfluenced` eligibility primitive (influence ⊥ eldritch) the eldritch module
 * placed. Clean-room; analysis/information only; manual-invoke. Confirmed PoE 1, current 3.28.
 *
 * Data grounding (repoe-fork mods.json): influenced mods are ordinary prefix/suffix mods gated by
 * a COMPOUND `{slotTag}_{codename}` spawn tag (e.g. `gloves_shaper`, `helmet_eyrie`) that the game
 * adds to the item on influence. So the influenced pool = mods whose resolved weight is 0 on the
 * bare base but > 0 once the base tags are augmented with `{tag}_{codename}`. Conqueror codenames:
 * crusader, eyrie=Redeemer, basilisk=Hunter, adjudicator=Warlord (+ shaper / elder).
 */
import type { RepoeMod } from '../data/repoe'
import { effectiveWeight, type Slot } from './craftingModel'
import type { ItemState } from './itemState'
import { isInfluenced } from './eldritch'
import type { CraftModule, InputSet, CraftDataContext, ModuleParams, OutcomeDistribution } from './craftModule'
import type { ExpectedAttemptsResult, PlanStepBlueprint } from './craftMethods'

export type Influence = 'shaper' | 'elder' | 'crusader' | 'redeemer' | 'hunter' | 'warlord'
export const INFLUENCES: Influence[] = ['shaper', 'elder', 'crusader', 'redeemer', 'hunter', 'warlord']
/** User-facing influence → data codename used in the compound spawn tag. */
const CODENAME: Record<Influence, string> = {
  shaper: 'shaper', elder: 'elder', crusader: 'crusader',
  redeemer: 'eyrie', hunter: 'basilisk', warlord: 'adjudicator',
}
/** The exalt that adds each influence (Conqueror/Shaper/Elder). */
const EXALT: Record<Influence, string> = {
  shaper: "Shaper's Exalted Orb", elder: "Elder's Exalted Orb", crusader: "Crusader's Exalted Orb",
  redeemer: "Redeemer's Exalted Orb", hunter: "Hunter's Exalted Orb", warlord: "Warlord's Exalted Orb",
}
/** Bases the Orb of Dominance (ex-Maven's Orb) elevate applies to. */
const DOMINANCE_BASE_TAGS = ['body_armour', 'boots', 'gloves', 'helmet'] as const

/** Augment base tags with the influence compound tags so `effectiveWeight` resolves the gated pool. */
export function influencedTags(baseTags: Set<string>, influence: Influence): Set<string> {
  const code = CODENAME[influence]
  const out = new Set(baseTags)
  for (const t of baseTags) out.add(`${t}_${code}`)
  return out
}

// ── Influence-gated pool index (reuses effectiveWeight) ─────────────────────────

export interface InfluenceEntry {
  modId: string
  group: string
  affix: Slot
  text?: string
  /** Resolved weight on this base WITH the influence tag (the influence-gated weight). */
  weight: number
}
export interface InfluenceIndex {
  influence: Influence
  prefixes: InfluenceEntry[]
  suffixes: InfluenceEntry[]
  /** Combined influenced-pool weight (an exalt rolls one influenced mod across both slots). */
  total: number
}

/**
 * The mods a given influence ADDS on this base: gated to > 0 only by the influence tag (resolved
 * weight 0 on the bare base, > 0 once augmented). ilvl-gated. Excludes essence-only.
 */
export function buildInfluenceIndex(baseTags: Set<string>, influence: Influence, ilvl: number, mods: Record<string, RepoeMod>): InfluenceIndex {
  const aug = influencedTags(baseTags, influence)
  const prefixes: InfluenceEntry[] = []
  const suffixes: InfluenceEntry[] = []
  for (const modId in mods) {
    const m = mods[modId]
    if (m.domain !== 'item' || (m.generation_type !== 'prefix' && m.generation_type !== 'suffix')) continue
    if (m.is_essence_only || m.required_level > ilvl) continue
    if (effectiveWeight(m, baseTags) > 0) continue // rolls on the bare base ⇒ not influence-only
    const weight = effectiveWeight(m, aug)
    if (weight <= 0) continue
    const entry: InfluenceEntry = { modId, group: m.groups?.[0] ?? modId, affix: m.generation_type as Slot, text: m.text, weight }
    ;(m.generation_type === 'prefix' ? prefixes : suffixes).push(entry)
  }
  return { influence, prefixes, suffixes, total: [...prefixes, ...suffixes].reduce((s, e) => s + e.weight, 0) }
}

/** P(an exalt adds the named influenced mod) = weight / combined influenced pool. */
export function influenceRollProbability(idx: InfluenceIndex, target: { group?: string; modId?: string }): number {
  if (idx.total <= 0) return 0
  let w = 0
  for (const e of [...idx.prefixes, ...idx.suffixes]) {
    if (target.modId) { if (e.modId === target.modId) w += e.weight }
    else if (target.group && e.group === target.group) w += e.weight
  }
  return w / idx.total
}

// ── Module helpers ──────────────────────────────────────────────────────────────

const unsupportedR = (method: string, reason: string): ExpectedAttemptsResult =>
  ({ method, supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] })

const influencedCount = (s: ItemState): number => s.affixes.filter(a => a.influenced).length
const hasInfluencedMatch = (s: ItemState, t: { group?: string; modId?: string }): boolean =>
  s.affixes.some(a => a.influenced && (t.modId ? a.modId === t.modId : t.group ? a.group === t.group : false))

const stepsFrom = (r: ExpectedAttemptsResult): PlanStepBlueprint[] => {
  if (!r.supported) return []
  if (r.perAttemptProb >= 1 || r.expectedAttempts <= 1) {
    return r.consumables.map(c => ({ kind: 'fixed', label: c.name, consumable: { name: c.name, category: c.category }, qty: 1 }))
  }
  return r.consumables.map(c => ({ kind: 'keep-trying', label: c.name, p: r.perAttemptProb, consumable: { name: c.name, category: c.category }, qty: 1 }))
}

// ── 1. Add-influence-mod (Conqueror / Shaper / Elder exalt) — arity 1 ────────────

function evalAddInfluence(state: ItemState, data: CraftDataContext, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as { kind: 'add-influence'; influence: Influence }
  const title = `add-influence (${method.influence})`
  if (isInfluenced(state)) return unsupportedR(title, `item already influenced (${state.influence.join(', ')}); a Conqueror/Shaper/Elder exalt needs a NO-influence rare`)
  if (state.corrupted) return unsupportedR(title, 'corrupted items cannot be influenced')
  const d = params.desired[0]
  if (!d || (!d.group && !d.modId)) return unsupportedR(title, 'name the specific influenced mod (group or modId) — specificity is the product')
  const idx = buildInfluenceIndex(new Set(state.tags), method.influence, state.ilvl, data.mods)
  if (idx.total <= 0) return unsupportedR(title, `no ${method.influence} influenced mods roll on this base/ilvl`)
  const p = influenceRollProbability(idx, { group: d.group, modId: d.modId })
  if (p <= 0) return unsupportedR(title, `${d.label} is not in the ${method.influence} influenced pool on this base (weight 0)`)
  const attempts = 1 / p
  return {
    method: title, supported: true, expectedAttempts: attempts, perAttemptProb: p,
    consumables: [{ name: EXALT[method.influence], qty: attempts, category: 'currency' }],
    lowConfidence: true,
    notes: [
      `P(${d.label}) per ${EXALT[method.influence]} = ${(p * 100).toFixed(2)}% (weight/pool over ${idx.prefixes.length + idx.suffixes.length} ${method.influence} mods).`,
      'The exalt adds the influence + one influenced mod; a MISS leaves the item influenced (cannot re-exalt) ⇒ expected count assumes re-rolling a fresh no-influence base per miss, or using Awakener\'s.',
    ],
  }
}

// ── 2. Awakener's Orb (arity 2 — reuses the two-item channel) ────────────────────

/**
 * Two influenced inputs (different influences, same item class) → output with BOTH influences,
 * carrying ONE influenced mod from EACH input (which one is random among that input's influenced
 * mods) and rerolling the rest. P(carry both named) = Π 1/influencedCount(input).
 * ⚠ FLAG: the "one guaranteed per input, then reroll" carry semantics are the community-sourced
 * rule (not in the data export) — confirm before trusting tight numbers.
 */
function evalAwakeners(a: ItemState, b: ItemState, params: ModuleParams): ExpectedAttemptsResult {
  const title = "Awakener's Orb"
  if (!isInfluenced(a) || !isInfluenced(b)) return unsupportedR(title, 'both inputs must be influenced items')
  if (a.itemClass !== b.itemClass) return unsupportedR(title, `Awakener's needs the same item class (got ${a.itemClass} + ${b.itemClass})`)
  const sharedInfluence = a.influence.some(i => b.influence.includes(i))
  if (sharedInfluence) return unsupportedR(title, 'inputs must carry DIFFERENT influences (same influence cannot merge)')
  const nA = influencedCount(a), nB = influencedCount(b)
  if (nA < 1 || nB < 1) return unsupportedR(title, 'each input needs at least one influenced mod (mark affixes `influenced`)')
  // desired: the mod to carry from each input — match each to the input that holds it.
  const desired = params.desired
  if (desired.length !== 2) return unsupportedR(title, 'name exactly two carried mods — one per input')
  const [d0, d1] = desired
  const map = hasInfluencedMatch(a, d0) && hasInfluencedMatch(b, d1) ? [nA, nB]
    : hasInfluencedMatch(a, d1) && hasInfluencedMatch(b, d0) ? [nA, nB] : null
  if (!map) return unsupportedR(title, 'each desired carried mod must be an influenced mod on one of the inputs (one per input)')
  const p = (1 / nA) * (1 / nB)
  const attempts = 1 / p
  return {
    method: title, supported: true, expectedAttempts: attempts, perAttemptProb: p,
    consumables: [{ name: "Awakener's Orb", qty: attempts, category: 'currency' }],
    lowConfidence: true,
    notes: [
      `Carries ONE influenced mod from each input (random among that input's influenced mods): ` +
        `P(carry both named) = 1/${nA} × 1/${nB} = ${(p * 100).toFixed(1)}%. Output gains both influences (${[...a.influence, ...b.influence].join(' + ')}).`,
      `⚠ Carry semantics (one guaranteed per input, then reroll) are community-sourced — not in the data export.`,
      `Donors with exactly ONE influenced mod each ⇒ guaranteed transfer (P=100%); the donor item value is the real cost.`,
    ],
  }
}

// ── 3. Orb of Dominance — elevate + collateral (arity 1) ─────────────────────────

function evalDominance(state: ItemState, params: ModuleParams): ExpectedAttemptsResult {
  const title = 'Orb of Dominance (elevate)'
  const eligibleBase = state.tags.some(t => (DOMINANCE_BASE_TAGS as readonly string[]).includes(t))
  if (!eligibleBase) return unsupportedR(title, `Orb of Dominance elevate applies to ${DOMINANCE_BASE_TAGS.join(' / ')} (base tags: ${state.tags.join(', ')})`)
  const n = influencedCount(state)
  if (n < 2) return unsupportedR(title, `needs ≥2 influenced mods (have ${n}); mark affixes \`influenced\``)
  const d = params.desired[0]
  if (d && !hasInfluencedMatch(state, d)) return unsupportedR(title, `${d.label} is not an influenced mod on this item`)
  const p = 1 / n // which influenced mod is elevated is random
  const attempts = 1 / p
  return {
    method: title, supported: true, expectedAttempts: attempts, perAttemptProb: p,
    consumables: [{ name: 'Orb of Dominance', qty: attempts, category: 'currency' }],
    lowConfidence: true,
    notes: [
      `Elevates ONE random influenced mod (P(intended) = 1/${n} = ${(p * 100).toFixed(0)}%) — top-tier ⇒ Elevated.`,
      `COLLATERAL (certain): one OTHER influenced mod is removed at random ⇒ expect to lose 1 of the remaining ${n - 1} influenced mod(s) each use.`,
      `⚠ Elevated-tier value scaling is not cleanly in the export — the elevate BENEFIT is qualitative here; the collateral LOSS is modelled.`,
    ],
  }
}

// ── Module wrappers ──────────────────────────────────────────────────────────────

const outcomesFrom = (state: ItemState, r: ExpectedAttemptsResult): OutcomeDistribution =>
  r.supported
    ? { outcomes: r.perAttemptProb >= 1 ? [{ p: 1, state }] : [{ p: r.perAttemptProb, state }, { p: 1 - r.perAttemptProb, state }] }
    : { outcomes: [{ p: 1, state }], notes: [r.reason ?? 'unsupported'] }

const arity1 = (
  id: string, title: string,
  evalFn: (state: ItemState, data: CraftDataContext, params: ModuleParams) => ExpectedAttemptsResult,
): CraftModule => ({
  id, title, arity: 1, respectsLocks: true,
  evaluate: (inputs: InputSet, data, params) => evalFn(inputs[0], data, params),
  applicable: (inputs: InputSet, data, params) => { const r = evalFn(inputs[0], data, params); return { ok: r.supported, reason: r.reason } },
  outcomes: (inputs: InputSet, data, params) => outcomesFrom(inputs[0], evalFn(inputs[0], data, params)),
  cost: (inputs: InputSet, data, params) => { const r = evalFn(inputs[0], data, params); return { steps: stepsFrom(r), lowConfidence: r.lowConfidence } },
  toRiskSteps: (inputs: InputSet, data, params) => stepsFrom(evalFn(inputs[0], data, params)),
})

export const addInfluenceModule = arity1('add-influence', 'Add influence mod (Conqueror/Shaper/Elder exalt)', evalAddInfluence)
export const orbOfDominanceModule = arity1('orb-of-dominance', 'Orb of Dominance (elevate)', (state, _data, params) => evalDominance(state, params))

export const awakenersModule: CraftModule = {
  id: 'awakeners', title: "Awakener's Orb (merge influences)", arity: 2, respectsLocks: true,
  evaluate: (inputs: InputSet, _data, params) => { const [a, b] = inputs as readonly [ItemState, ItemState]; return evalAwakeners(a, b, params) },
  applicable: (inputs: InputSet, _data, params) => {
    if (inputs.length !== 2) return { ok: false, reason: "Awakener's needs exactly two input items" }
    const [a, b] = inputs as readonly [ItemState, ItemState]; const r = evalAwakeners(a, b, params)
    return { ok: r.supported, reason: r.reason }
  },
  outcomes: (inputs: InputSet, _data, params) => { const [a, b] = inputs as readonly [ItemState, ItemState]; const r = evalAwakeners(a, b, params); return r.supported ? { outcomes: [{ p: 0.5, state: a }, { p: 0.5, state: b }], notes: ['base 50/50; carry folded into perAttemptProb'] } : { outcomes: [{ p: 1, state: a }], notes: [r.reason ?? 'unsupported'] } },
  cost: (inputs: InputSet, _data, params) => { const [a, b] = inputs as readonly [ItemState, ItemState]; const r = evalAwakeners(a, b, params); return { steps: stepsFrom(r), lowConfidence: true } },
  toRiskSteps: (inputs: InputSet, _data, params) => { const [a, b] = inputs as readonly [ItemState, ItemState]; return stepsFrom(evalAwakeners(a, b, params)) },
}
