/**
 * services — Eldritch implicits (first Tier-1 coverage module).
 *
 * PoE 1, stable since 3.17 (current 3.28). An item can hold one Searing Exarch implicit
 * (Embers) and one Eater of Worlds implicit (Ichors) at once. This module costs hitting a
 * SPECIFIC NAMED implicit via the same resolved-weight machinery the explicit weight-index
 * uses (`effectiveWeight` over the eldritch implicit `generation_type`s) — no scrape, no new
 * weight derivation. The dominance-targeting orbs (Eldritch Exalt/Annul) are modelled as a
 * side-restricted add/removal on the EXPLICIT pool (the deterministic "act on one side" lever).
 *
 * Data grounding (repoe-fork mods.json):
 *  - implicits live as `generation_type` 'searing_exarch_implicit' / 'eater_of_worlds_implicit'
 *    (domain 'item') — NOT prefix/suffix, so the explicit index skips them.
 *  - each implicit has 3 value-variants: base / `*UniquePresence` / `*PinnaclePresence` (the
 *    altar-presence value scaling). Only the BASE variant is the costing pool (others would
 *    multi-count the same roll).
 *  - eligibility = base carries one of gloves/boots/helmet/body_armour/amulet.
 *  - value rows are tier-gated by `no_tier_N_eldritch_implicit` spawn tags (N: 1=highest value
 *    … 6=lowest). The currency-tier → which-implicit-tiers mapping is NOT in this export (it is
 *    in the currency item defs we don't consume) → the full pool = the top "Exceptional" currency;
 *    lower currency tiers roll a SUBSET (flagged, see notes).
 *
 * Clean-room; analysis/information only; manual-invoke. Eldritch ⊥ influence (shared with the
 * influence module — see `isInfluenced`).
 */
import type { RepoeMod } from '../data/repoe'
import { effectiveWeight, buildSlotPool, slotShare, type Slot } from './craftingModel'
import type { ItemState } from './itemState'
import type { CraftModule, InputSet, CraftDataContext, ModuleParams, OutcomeDistribution } from './craftModule'
import type { ExpectedAttemptsResult, PlanStepBlueprint, CraftMethod } from './craftMethods'

export type EldritchSide = 'exarch' | 'eater'
export const ELDRITCH_GEN: Record<EldritchSide, string> = {
  exarch: 'searing_exarch_implicit',
  eater: 'eater_of_worlds_implicit',
}
/** Base-type tags an eldritch implicit can roll on (+ the unique amulet Eternal Struggle). */
export const ELDRITCH_BASE_TAGS = ['gloves', 'boots', 'helmet', 'body_armour', 'amulet'] as const

export const ELDRITCH_TIERS = ['lesser', 'greater', 'grand', 'exceptional'] as const
export type EldritchTier = (typeof ELDRITCH_TIERS)[number]
const EMBER: Record<EldritchTier, string> = {
  lesser: 'Lesser Eldritch Ember', greater: 'Greater Eldritch Ember',
  grand: 'Grand Eldritch Ember', exceptional: 'Exceptional Eldritch Ember',
}
const ICHOR: Record<EldritchTier, string> = {
  lesser: 'Lesser Eldritch Ichor', greater: 'Greater Eldritch Ichor',
  grand: 'Grand Eldritch Ichor', exceptional: 'Exceptional Eldritch Ichor',
}
/** The currency that rolls a given side's implicit at a given tier (Embers=Exarch, Ichors=Eater). */
export const eldritchCurrency = (side: EldritchSide, tier: EldritchTier): string =>
  side === 'exarch' ? EMBER[tier] : ICHOR[tier]

// ── Eligibility (shared primitive: eldritch ⊥ influence) ────────────────────────

/** Shared influence primitive — the influence module reuses this for the same exclusion. */
export const isInfluenced = (s: ItemState): boolean => s.influence.length > 0

/** Can this item take eldritch implicits? (base type eligible, not influenced, not corrupted.) */
export function eldritchEligibility(s: ItemState): { ok: boolean; reason?: string } {
  if (s.corrupted) return { ok: false, reason: 'corrupted items cannot be modified by eldritch currency' }
  if (isInfluenced(s)) {
    return { ok: false, reason: `eldritch ⊥ influence: influenced items (${s.influence.join(', ')}) cannot take eldritch implicits` }
  }
  const tag = s.tags.find(t => (ELDRITCH_BASE_TAGS as readonly string[]).includes(t))
  if (!tag) return { ok: false, reason: `eldritch implicits roll only on ${ELDRITCH_BASE_TAGS.join(' / ')} (base tags: ${s.tags.join(', ')})` }
  return { ok: true }
}

// ── Eldritch implicit index (reuses effectiveWeight; base variant only) ─────────

export interface EldritchEntry {
  modId: string
  group: string
  /** The discrete implicit value, e.g. "13% increased Attack Speed". */
  text: string
  /** Resolved spawn weight on this base. */
  weight: number
  /** Tier from the `no_tier_N` gate: 1 = highest value … 6 = lowest. 0 = ungated. */
  tier: number
}
export interface EldritchIndex {
  side: EldritchSide
  entries: EldritchEntry[]
  total: number
  /** Distinct implicit groups in the pool. */
  groups: number
}

const isBaseVariant = (m: RepoeMod): boolean => !/(UniquePresence|PinnaclePresence)$/.test(m.type)

/** Tier from the gate tag (`no_tier_N_eldritch_implicit` weight 0 ⇒ this row is tier N). */
function rowTier(m: RepoeMod): number {
  for (const s of m.spawn_weights ?? []) {
    const match = /^no_tier_(\d)_eldritch_implicit$/.exec(s.tag)
    if (match && s.weight === 0) return Number(match[1])
  }
  return 0
}

/**
 * The full eligible eldritch implicit pool for `side` on a base (base value-variant only).
 * Full pool = the top "Exceptional" currency; lower currency tiers roll a subset (flagged).
 */
export function buildEldritchIndex(baseTags: Set<string>, side: EldritchSide, mods: Record<string, RepoeMod>): EldritchIndex {
  const gen = ELDRITCH_GEN[side]
  const entries: EldritchEntry[] = []
  const groups = new Set<string>()
  for (const modId in mods) {
    const m = mods[modId]
    if (m.generation_type !== gen || !isBaseVariant(m)) continue
    const weight = effectiveWeight(m, baseTags)
    if (weight <= 0) continue
    const group = m.groups?.[0] ?? modId
    groups.add(group)
    entries.push({ modId, group, text: (m.text ?? '').replace(/\n/g, ' / '), weight, tier: rowTier(m) })
  }
  return { side, entries, total: entries.reduce((s, e) => s + e.weight, 0), groups: groups.size }
}

/**
 * P(rolling the named implicit) on this base = Σ weight(target rows) / pool total. `modId` →
 * that exact value row; `group` → the implicit family (any value), optionally pinned to `tier`.
 */
export function eldritchRollProbability(idx: EldritchIndex, target: { group?: string; modId?: string; tier?: number }): number {
  if (idx.total <= 0) return 0
  let w = 0
  for (const e of idx.entries) {
    if (target.modId) { if (e.modId === target.modId) w += e.weight }
    else if (target.group && e.group === target.group && (target.tier == null || e.tier === target.tier)) w += e.weight
  }
  return w / idx.total
}

/**
 * FLAGGED representative first cut — NOT a tier random-walk simulation. Orb of Conflict raises
 * one eldritch implicit a tier while lowering the other; net upward progress on the desired side
 * happens on ~half of uses. Tiers are 1=best, so improving means decreasing the number.
 */
export function orbOfConflictEV(fromTier: number, toTier: number): { orbs: number; note: string } {
  const gain = Math.max(0, fromTier - toTier)
  return {
    orbs: gain * 2,
    note: 'representative: assumes ~50% of Orbs of Conflict move the desired side upward (the paired downgrade + the true random-walk are NOT simulated)',
  }
}

// ── Modules ─────────────────────────────────────────────────────────────────────

const unsupportedR = (method: string, reason: string): ExpectedAttemptsResult =>
  ({ method, supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] })

const keepTryingStep = (name: string, p: number): PlanStepBlueprint =>
  ({ kind: 'keep-trying', label: name, p, consumable: { name, category: 'currency' }, qty: 1 })

const TIER_POOL_FLAG =
  '⚠ Pool = full (top "Exceptional" currency). Lower currency tiers (Lesser/Greater/Grand) roll a ' +
  'SUBSET — cheaper per use but cannot reach the top value tiers; the currency→implicit-tier ' +
  'mapping is not in the data export (value-tier flagged).'

/** CORE — roll a specific eldritch implicit (Exarch side = prefix-dominant, Eater = suffix-dominant). */
function evalImplicit(state: ItemState, data: CraftDataContext, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as Extract<CraftMethod, { kind: 'eldritch-implicit' }>
  const elig = eldritchEligibility(state)
  if (!elig.ok) return unsupportedR('eldritch implicit', elig.reason!)
  const d = params.desired[0]
  if (!d || (!d.group && !d.modId)) {
    return unsupportedR('eldritch implicit', 'name the specific eldritch implicit (group or modId), not "any implicit" — specificity is the product')
  }
  const side: EldritchSide = d.slot === 'suffix' ? 'eater' : 'exarch'
  const tier: EldritchTier = method.tier ?? 'exceptional'
  const idx = buildEldritchIndex(new Set(state.tags), side, data.mods)
  const p = eldritchRollProbability(idx, { group: d.group, modId: d.modId, tier: method.implicitTier })
  if (p <= 0) {
    return unsupportedR(`eldritch implicit (${side})`, `${d.label} is not in the ${side} implicit pool on this base (resolved weight 0)`)
  }
  const attempts = 1 / p
  const currency = eldritchCurrency(side, tier)
  const notes = [
    `${side === 'exarch' ? 'Searing Exarch' : 'Eater of Worlds'} implicit. P(${d.label}) per ${currency} = ${(p * 100).toFixed(2)}% ` +
      `(weight/pool over ${idx.entries.length} value-rows in ${idx.groups} implicit groups).`,
    TIER_POOL_FLAG,
    'Value-variant scaling (Unique/Pinnacle altar presence) excluded from the pool — base values only.',
  ]
  if (tier !== 'exceptional') notes.push(`⚠ priced at the ${tier} currency but P is computed on the FULL pool — the ${tier} subset differs (cannot hit top value tiers).`)
  return {
    method: `eldritch implicit (${side}, ${tier})`,
    supported: true, expectedAttempts: attempts, perAttemptProb: p,
    consumables: [{ name: currency, qty: attempts, category: 'currency' }],
    lowConfidence: true, notes,
  }
}

/** Dominance-targeting ADD: Eldritch Exalt fills the DOMINANT side (Exarch=prefix, Eater=suffix). */
function evalExalt(state: ItemState, data: CraftDataContext, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as Extract<CraftMethod, { kind: 'eldritch-exalt' }>
  const elig = eldritchEligibility(state)
  if (!elig.ok) return unsupportedR('eldritch exalt', elig.reason!)
  const slot: Slot = method.dominant === 'exarch' ? 'prefix' : 'suffix'
  const d = params.desired[0]
  if (!d || (!d.group && !d.modId)) return unsupportedR('eldritch exalt', 'name the specific mod to add on the dominant side')
  if (d.slot !== slot) return unsupportedR('eldritch exalt', `dominant side is ${method.dominant} ⇒ acts on ${slot}; desired mod is a ${d.slot}`)
  const pool = buildSlotPool(data.mods, new Set(state.tags), state.ilvl, slot, { meta: state.meta })
  const share = slotShare(pool, e => (d.modId ? e.id === d.modId : d.group ? e.group === d.group : false))
  if (share <= 0) return unsupportedR(`eldritch exalt (${slot})`, `${d.label} cannot roll in the ${slot} slot (weight 0)`)
  const attempts = 1 / share
  return {
    method: `eldritch exalt → ${method.dominant} (${slot})`,
    supported: true, expectedAttempts: attempts, perAttemptProb: share,
    consumables: [{ name: 'Eldritch Exalted Orb', qty: attempts, category: 'currency' }],
    lowConfidence: true,
    notes: [
      `Targeted add to the DOMINANT (${method.dominant}) side = ${slot}. P(${d.label}) = ${(share * 100).toFixed(2)}% (share of the open ${slot} pool).`,
      'A wrong add must be removed (Eldritch Annulment) before re-exalting — that loop is NOT folded into the EV (flagged).',
    ],
  }
}

/** Dominance-targeting REMOVAL: Eldritch Annul removes from the DOMINANT side (the deterministic side-pick). */
function evalAnnul(state: ItemState, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as Extract<CraftMethod, { kind: 'eldritch-annul' }>
  const elig = eldritchEligibility(state)
  if (!elig.ok) return unsupportedR('eldritch annul', elig.reason!)
  const slot: Slot = method.dominant === 'exarch' ? 'prefix' : 'suffix'
  const onSide = state.affixes.filter(a => a.slot === slot)
  const n = onSide.length
  if (n === 0) return unsupportedR('eldritch annul', `no ${slot} affixes to remove on the dominant (${method.dominant}) side`)
  const p = 1 / n
  return {
    method: `eldritch annul → ${method.dominant} (${slot})`,
    supported: true, expectedAttempts: 1, perAttemptProb: p,
    consumables: [{ name: 'Eldritch Annulment Orb', qty: 1, category: 'currency' }],
    lowConfidence: true,
    notes: [
      `Removes ONE affix from the DOMINANT (${method.dominant}) side = ${slot}. ${n} ${slot} affix(es) present ⇒ ` +
        `P(removing a specific target) = ${(p * 100).toFixed(0)}% per orb; block/fill the others to make the side-pick deterministic.`,
      '⚠ Eldritch Annulment Orb is not tracked by the price feed — supply a manual price.',
    ],
  }
}

const outcomesFrom = (state: ItemState, r: ExpectedAttemptsResult): OutcomeDistribution =>
  r.supported
    ? { outcomes: r.perAttemptProb >= 1 ? [{ p: 1, state }] : [{ p: r.perAttemptProb, state }, { p: 1 - r.perAttemptProb, state }] }
    : { outcomes: [{ p: 1, state }], notes: [r.reason ?? 'unsupported'] }

const stepsFrom = (r: ExpectedAttemptsResult): PlanStepBlueprint[] => {
  if (!r.supported) return []
  if (r.perAttemptProb >= 1 || r.expectedAttempts <= 1) {
    return r.consumables.map(c => ({ kind: 'fixed', label: c.name, consumable: { name: c.name, category: c.category }, qty: 1 }))
  }
  return r.consumables.map(c => keepTryingStep(c.name, r.perAttemptProb))
}

const moduleFrom = (
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

export const eldritchImplicitModule = moduleFrom('eldritch-implicit', 'Eldritch implicit', evalImplicit)
export const eldritchExaltModule = moduleFrom('eldritch-exalt', 'Eldritch Exalt (dominant side)', evalExalt)
export const eldritchAnnulModule = moduleFrom('eldritch-annul', 'Eldritch Annul (dominant side)', (state, _data, params) => evalAnnul(state, params), ['Eldritch Annulment Orb'])
