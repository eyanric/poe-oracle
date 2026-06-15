/**
 * services — Veiled crafting (Tier-2). CORRECTED for the Syndicate rework: Aisling safehouse
 * slams are GONE. Veiled mods are now added via the Veiled Chaos Orb (reroll + guaranteed veiled,
 * cheap/destructive) or the Veiled Exalted Orb (clean add to an open slot, expensive/non-destructive).
 *
 * An unveiled mod occupies a NORMAL affix slot (stronger than the bench version), so it is modelled
 * on the explicit pool — NOT a crafted slot. The unveil shows 1-of-3 from the `unveiled` domain
 * pool for the item + affix; pre-blocking unwanted veils (filled/blocked groups) shrinks the pool
 * and raises P(desired among the 3). Both orbs draw the SAME pool ⇒ identical P(desired); they
 * differ only in cost and item-state effect.
 *
 * Data: `unveiled` domain mods (the real outcomes), spawn-weighted by item-type tag. The `veiled`
 * domain holds the placeholders only. Clean-room; analysis-only; manual-invoke.
 */
import type { RepoeMod } from '../data/repoe'
import { effectiveWeight, pPresentInSlots, type Slot } from './craftingModel'
import { openSlots, type ItemState } from './itemState'
import type { CraftModule, InputSet, CraftDataContext, ModuleParams, OutcomeDistribution } from './craftModule'
import type { ExpectedAttemptsResult, PlanStepBlueprint } from './craftMethods'

/** Number of options shown when unveiling (choose 1 of 3). */
export const UNVEIL_CHOICES = 3

const VEILED_CURRENCY: Record<'veiled-chaos' | 'veiled-exalt', string> = {
  'veiled-chaos': 'Veiled Chaos Orb',
  'veiled-exalt': 'Veiled Exalted Orb',
}

export interface VeiledEntry {
  modId: string
  group: string
  affix: Slot
  text?: string
  weight: number
}
export interface VeiledPool {
  affix: Slot
  entries: VeiledEntry[]
  total: number
}

/**
 * The unveiled-domain pool for an affix on a base. `exclude` removes groups that are blocked or
 * already present (the pre-blocking lever that raises the desired mod's share).
 */
export function buildVeiledPool(baseTags: Set<string>, affix: Slot, ilvl: number, mods: Record<string, RepoeMod>, exclude: Set<string> = new Set()): VeiledPool {
  const entries: VeiledEntry[] = []
  for (const modId in mods) {
    const m = mods[modId]
    if (m.domain !== 'unveiled' || m.generation_type !== affix || m.required_level > ilvl) continue
    const group = m.groups?.[0] ?? modId
    if (exclude.has(group)) continue
    const weight = effectiveWeight(m, baseTags)
    if (weight <= 0) continue
    entries.push({ modId, group, affix, text: m.text, weight })
  }
  return { affix, entries, total: entries.reduce((s, e) => s + e.weight, 0) }
}

/** Share of the veiled pool the named target occupies (modId = that mod; group = its family). */
export function unveilShare(pool: VeiledPool, target: { group?: string; modId?: string }): number {
  if (pool.total <= 0) return 0
  let w = 0
  for (const e of pool.entries) {
    if (target.modId) { if (e.modId === target.modId) w += e.weight }
    else if (target.group && e.group === target.group) w += e.weight
  }
  return w / pool.total
}

/** P(the desired veiled mod is among the 1-of-3 shown) — 1-(1-share)^3 (flagged approximation). */
export const pUnveil = (share: number): number => pPresentInSlots(share, UNVEIL_CHOICES)

const unsupportedR = (method: string, reason: string): ExpectedAttemptsResult =>
  ({ method, supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] })

function evalVeiled(state: ItemState, data: CraftDataContext, params: ModuleParams, orb: 'veiled-chaos' | 'veiled-exalt'): ExpectedAttemptsResult {
  const title = VEILED_CURRENCY[orb]
  const d = params.desired[0]
  if (!d || (!d.group && !d.modId)) return unsupportedR(title, 'name the specific veiled mod (group or modId), not "any veiled" — specificity is the product')
  const affix = d.slot
  // Pre-blocking lever: exclude blocked + already-present groups from the unveil pool.
  const exclude = new Set<string>([...state.blockedGroups, ...state.affixes.map(a => a.group)])
  const pool = buildVeiledPool(new Set(state.tags), affix, state.ilvl, data.mods, exclude)
  if (pool.total <= 0) return unsupportedR(title, `no veiled ${affix} mods roll on this base/ilvl`)
  const share = unveilShare(pool, { group: d.group, modId: d.modId })
  if (share <= 0) return unsupportedR(title, `${d.label} is not in the veiled ${affix} pool on this base (weight 0 / blocked / already present)`)
  const p = pUnveil(share)
  const attempts = 1 / p

  if (orb === 'veiled-exalt' && openSlots(state, affix) <= 0) {
    return unsupportedR(title, `Veiled Exalt adds to an OPEN ${affix} slot — none free. Use Veiled Chaos (reroll) instead.`)
  }

  const existing = state.affixes.length
  const notes: string[] = [
    `Veiled = NORMAL-slot mod (not a crafted slot). P(${d.label} among ${UNVEIL_CHOICES}) = ${(p * 100).toFixed(1)}% ` +
      `(share ${(share * 100).toFixed(1)}% of a ${pool.entries.length}-mod veiled ${affix} pool) ⇒ ~${attempts.toFixed(1)} ${title}.`,
    `Pre-blocking unwanted veils (fill/block their groups) shrinks the pool and raises this P — the with/without-blocking lever.`,
    orb === 'veiled-chaos'
      ? `⚠ DESTRUCTIVE: rerolls the whole item${existing ? ` (wipes ${existing} existing explicit mod(s))` : ''} — high brick risk on a valuable item; use on a fresh/cheap base. Retries are clean (each reroll re-veils).`
      : `NON-DESTRUCTIVE: clean add to an open ${affix} slot (no reroll, no prefix/suffix protection needed). ⚠ A wrong unveil must be annulled before re-exalting (retry loop not folded into the EV).`,
    `Same veiled pool as ${orb === 'veiled-chaos' ? 'Veiled Exalt' : 'Veiled Chaos'} ⇒ identical P(desired); only cost + item-state effect differ.`,
  ]
  return {
    method: title, supported: true, expectedAttempts: attempts, perAttemptProb: p,
    consumables: [{ name: VEILED_CURRENCY[orb], qty: attempts, category: 'currency' }],
    lowConfidence: true, notes,
  }
}

const outcomesFrom = (state: ItemState, r: ExpectedAttemptsResult): OutcomeDistribution =>
  r.supported
    ? { outcomes: r.perAttemptProb >= 1 ? [{ p: 1, state }] : [{ p: r.perAttemptProb, state }, { p: 1 - r.perAttemptProb, state }] }
    : { outcomes: [{ p: 1, state }], notes: [r.reason ?? 'unsupported'] }

const stepsFrom = (r: ExpectedAttemptsResult): PlanStepBlueprint[] => {
  if (!r.supported) return []
  if (r.perAttemptProb >= 1) return r.consumables.map(c => ({ kind: 'fixed', label: c.name, consumable: { name: c.name, category: c.category }, qty: 1 }))
  return r.consumables.map(c => ({ kind: 'keep-trying', label: c.name, p: r.perAttemptProb, consumable: { name: c.name, category: c.category }, qty: 1 }))
}

const veiledModule = (orb: 'veiled-chaos' | 'veiled-exalt', title: string): CraftModule => ({
  id: orb, title, arity: 1, respectsLocks: true,
  evaluate: (inputs: InputSet, data, params) => evalVeiled(inputs[0], data, params, orb),
  applicable: (inputs: InputSet, data, params) => { const r = evalVeiled(inputs[0], data, params, orb); return { ok: r.supported, reason: r.reason } },
  outcomes: (inputs: InputSet, data, params) => outcomesFrom(inputs[0], evalVeiled(inputs[0], data, params, orb)),
  cost: (inputs: InputSet, data, params) => { const r = evalVeiled(inputs[0], data, params, orb); return { steps: stepsFrom(r), lowConfidence: r.lowConfidence } },
  toRiskSteps: (inputs: InputSet, data, params) => stepsFrom(evalVeiled(inputs[0], data, params, orb)),
})

export const veiledChaosModule = veiledModule('veiled-chaos', 'Veiled Chaos Orb (reroll + veiled)')
export const veiledExaltModule = veiledModule('veiled-exalt', 'Veiled Exalted Orb (clean veiled add)')
