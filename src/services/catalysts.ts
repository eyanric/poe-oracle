/**
 * services — Catalysts (Tier-1 deterministic module A).
 *
 * Catalysts add quality (cap 20%) to rings / amulets / belts, scaling the MAGNITUDE of
 * modifiers carrying the catalyst's tag. Deterministic.
 *
 * ⚠ SOURCING CORRECTION (flag-don't-invent): the prompt asked to model a "roll-weight bias"
 * (quality raising the spawn weight of matching-tag mods). That mechanic was REMOVED in
 * patch 3.15.0 — since then catalysts ONLY scale magnitude, they do NOT change roll chances
 * (poewiki / fandom Catalyst page). We are on 3.28, so the roll-weight bias is NOT modelled
 * (it would be a defunct mechanic). Magnitude scaling is the real, current effect.
 *
 * ⚠ The catalyst→tag map is NOT in the repoe-fork export (catalysts are plain currency in
 * base_items) — it is CURATED from the PoE wiki and flagged (provenance, like the Harvest data).
 * Tempering is a CORE defence catalyst (not Mirage, despite the prompt grouping). Only the
 * targeted-magnitude Sinistral / Dextral catalysts are league-gated to Mirage.
 */
import type { RepoeMod } from '../data/repoe'
import { effectiveWeight, type Slot } from './craftingModel'
import type { ItemState } from './itemState'
import { isLeagueActive } from './craftModule'
import type { CraftModule, InputSet, CraftDataContext, ModuleParams, OutcomeDistribution } from './craftModule'
import type { ExpectedAttemptsResult, PlanStepBlueprint } from './craftMethods'

export type Catalyst =
  | 'abrasive' | 'accelerating' | 'fertile' | 'imbued' | 'intrinsic'
  | 'noxious' | 'prismatic' | 'tempering' | 'turbulent' | 'sinistral' | 'dextral'

/** ⚠ CURATED (PoE wiki) — not in the data export. Tag(s) whose mod magnitudes the catalyst scales. */
const CATALYST_TAG: Record<Catalyst, string[]> = {
  abrasive: ['attack'], accelerating: ['speed'], fertile: ['life', 'mana'], imbued: ['caster'],
  intrinsic: ['attribute'], noxious: ['physical', 'chaos'], prismatic: ['resistance'],
  tempering: ['defences'], turbulent: ['elemental'],
  sinistral: [], dextral: [], // targeted by SLOT, not tag (Mirage)
}
const CATALYST_CURRENCY: Record<Catalyst, string> = {
  abrasive: 'Abrasive Catalyst', accelerating: 'Accelerating Catalyst', fertile: 'Fertile Catalyst',
  imbued: 'Imbued Catalyst', intrinsic: 'Intrinsic Catalyst', noxious: 'Noxious Catalyst',
  prismatic: 'Prismatic Catalyst', tempering: 'Tempering Catalyst', turbulent: 'Turbulent Catalyst',
  sinistral: 'Sinistral Catalyst', dextral: 'Dextral Catalyst',
}
/** Sinistral/Dextral scale a SLOT's magnitudes instead of a tag's. */
const CATALYST_SLOT: Partial<Record<Catalyst, Slot>> = { sinistral: 'prefix', dextral: 'suffix' }
/** League-gated to Mirage (reuse the Rancour gating). */
const MIRAGE_CATALYSTS = new Set<Catalyst>(['sinistral', 'dextral'])
const CATALYST_BASE_TAGS = ['ring', 'amulet', 'belt'] as const

export const QUALITY_CAP = 20
/** ⚠ Quality-per-catalyst is item-level dependent (~1–2%/use at high ilvl) ⇒ ~10–20 to cap on
 *  standard jewellery (flagged representative; the per-use curve is not in the export). */
const CATALYSTS_TO_CAP = 13

export const catalystTags = (c: Catalyst): string[] => CATALYST_TAG[c]
export const catalystCurrency = (c: Catalyst): string => CATALYST_CURRENCY[c]
/** Magnitude multiplier at a quality level (cap 20%). 20% ⇒ ×1.20 on matching-tag mods. */
export const magnitudeMultiplier = (quality: number): number => 1 + Math.min(Math.max(quality, 0), QUALITY_CAP) / 100

export function catalystEligibility(state: ItemState, catalyst: Catalyst, league?: string): { ok: boolean; reason?: string } {
  if (!state.tags.some(t => (CATALYST_BASE_TAGS as readonly string[]).includes(t))) {
    return { ok: false, reason: `catalysts apply to ${CATALYST_BASE_TAGS.join(' / ')} (base tags: ${state.tags.join(', ')})` }
  }
  if (MIRAGE_CATALYSTS.has(catalyst) && !isLeagueActive(['Mirage'], league)) {
    return { ok: false, reason: `${CATALYST_CURRENCY[catalyst]} is league-specific (Mirage), not active in "${league}"` }
  }
  return { ok: true }
}

/** Does a desired target carry the catalyst's tag (so the catalyst actually boosts it)? */
function targetCarriesTag(catalyst: Catalyst, target: { modId?: string; group?: string }, baseTags: Set<string>, mods: Record<string, RepoeMod>): boolean | null {
  const slot = CATALYST_SLOT[catalyst]
  if (slot) return null // slot-targeted — tag check N/A
  const tags = CATALYST_TAG[catalyst]
  if (target.modId) {
    const m = mods[target.modId]
    return m ? (m.implicit_tags ?? []).some(t => tags.includes(t)) : null
  }
  if (target.group) {
    // any mod in the group on this base carrying the tag
    for (const id in mods) {
      const m = mods[id]
      if (m.groups?.[0] !== target.group) continue
      if (effectiveWeight(m, baseTags) <= 0) continue
      return (m.implicit_tags ?? []).some(t => tags.includes(t))
    }
  }
  return null
}

function evalCatalyst(state: ItemState, data: CraftDataContext, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as { kind: 'catalyst'; catalyst: Catalyst; quality?: number; catalystCount?: number }
  const cat = method.catalyst
  const title = `catalyst (${CATALYST_CURRENCY[cat]})`
  const elig = catalystEligibility(state, cat, data.currentLeague)
  if (!elig.ok) return { method: title, supported: false, reason: elig.reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] }

  const quality = Math.min(method.quality ?? QUALITY_CAP, QUALITY_CAP)
  const mult = magnitudeMultiplier(quality)
  const slot = CATALYST_SLOT[cat]
  const scope = slot ? `${slot} modifiers` : `modifiers tagged [${CATALYST_TAG[cat].join(', ')}]`
  const count = method.catalystCount ?? CATALYSTS_TO_CAP

  const notes: string[] = [
    `Adds ${quality}% quality ⇒ ×${mult.toFixed(2)} MAGNITUDE on ${scope} (deterministic).`,
    `⚠ Roll-weight bias is NOT modelled — catalysts stopped affecting roll chances in patch 3.15.0; in 3.28 they ONLY scale magnitude.`,
    `⚠ Catalyst→tag map is curated (PoE wiki), not in the data export. Count to reach ${quality}% is ilvl-dependent (~10–20 on standard jewellery) — using ${count} as a flagged representative.`,
  ]

  const d = params.desired[0]
  if (d) {
    const carries = targetCarriesTag(cat, { modId: d.modId, group: d.group }, new Set(state.tags), data.mods)
    if (carries === false) notes.push(`⚠ "${d.label}" does not carry the ${CATALYST_TAG[cat].join('/')} tag — this catalyst will NOT boost it.`)
    else if (carries === true) notes.push(`"${d.label}" carries the tag ⇒ its value scales to ×${mult.toFixed(2)} at ${quality}% quality.`)
  }

  return {
    method: title, supported: true, expectedAttempts: 1, perAttemptProb: 1,
    consumables: [{ name: CATALYST_CURRENCY[cat], qty: count, category: 'currency' }],
    lowConfidence: true, notes,
  }
}

const stepsFrom = (r: ExpectedAttemptsResult): PlanStepBlueprint[] =>
  r.supported ? r.consumables.map(c => ({ kind: 'fixed', label: c.name, consumable: { name: c.name, category: c.category }, qty: c.qty })) : []

export const catalystModule: CraftModule = {
  id: 'catalyst', title: 'Catalyst (jewellery quality magnitude)', arity: 1, respectsLocks: true,
  evaluate: (inputs: InputSet, data, params) => evalCatalyst(inputs[0], data, params),
  applicable: (inputs: InputSet, data, params) => { const r = evalCatalyst(inputs[0], data, params); return { ok: r.supported, reason: r.reason } },
  outcomes: (inputs: InputSet, data, params): OutcomeDistribution => {
    const r = evalCatalyst(inputs[0], data, params)
    return r.supported ? { outcomes: [{ p: 1, state: inputs[0] }] } : { outcomes: [{ p: 1, state: inputs[0] }], notes: [r.reason ?? 'unsupported'] }
  },
  cost: (inputs: InputSet, data, params) => { const r = evalCatalyst(inputs[0], data, params); return { steps: stepsFrom(r), lowConfidence: r.lowConfidence } },
  toRiskSteps: (inputs: InputSet, data, params) => stepsFrom(evalCatalyst(inputs[0], data, params)),
}
