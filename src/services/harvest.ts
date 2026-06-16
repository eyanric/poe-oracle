/**
 * services — Harvest crafting module (first real method on the multi-arity interface).
 *
 * Single-item (arity 1), but the proving ground that genuinely READS the item state:
 * `augment` reads `blockedGroups` + occupied slots, so a pool blocked down to the
 * desired tag mod is DETERMINISTIC while an open pool is a distribution. Harvest reforge
 * RESPECTS "prefixes/suffixes cannot be changed" (`respectsLocks` from the lock matrix) —
 * it rerolls only the unlocked side, leaving the locked side intact (poewiki/Maxroll, 3.28).
 *
 * Pure/queryable. Costs are lifeforce (colour + amount) priced live; amounts are
 * low-confidence (see data/harvestCrafts.ts provenance).
 */
import { buildSlotPool, totalWeight, type ModEntry } from './craftingModel'
import { openSlots, groupsPresent, withAffix, type ItemState } from './itemState'
import {
  harvestCraft, LIFEFORCE_ITEM, RANCOUR_ITEM, HARVEST_TAG_TO_MODTAG, HARVEST_PROVENANCE, type HarvestCraft,
} from '../data/harvestCrafts'
import { isLeagueActive, type CraftModule, type InputSet, type CraftDataContext, type ModuleParams, type OutcomeDistribution, type Applicability } from './craftModule'
import { respectsLock } from './lockMatrix'
import type { ExpectedAttemptsResult, PlanStepBlueprint, DesiredMod, CraftMethod } from './craftMethods'
import type { RepoeMod } from '../data/repoe'

type HarvestMethod = Extract<CraftMethod, { kind: 'harvest' }>

const fail = (reason: string): ExpectedAttemptsResult =>
  ({ method: 'harvest', supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] })

const modHasTag = (mod: RepoeMod, modTag: string): boolean => (mod.implicit_tags ?? []).includes(modTag)
const matcher = (d: DesiredMod) => (e: ModEntry): boolean => (d.modId ? e.id === d.modId : d.group ? e.group === d.group : false)

/** Share of the desired mod within a tag-filtered sub-pool (the Harvest guarantee draws here). */
function tagShare(pool: ModEntry[], modTag: string, d: DesiredMod): { share: number; tagPoolSize: number } {
  const tagPool = pool.filter(e => modHasTag(e.mod, modTag))
  const total = totalWeight(tagPool)
  if (total <= 0) return { share: 0, tagPoolSize: 0 }
  const want = tagPool.filter(matcher(d)).reduce((s, e) => s + e.weight, 0)
  return { share: want / total, tagPoolSize: tagPool.length }
}

/** Harvest respects "cannot roll attack/caster" but NOT the prefix/suffix locks. */
const nonLockMeta = (state: ItemState) => ({ blockAttack: state.meta.noAttack, blockCaster: state.meta.noCaster })

function evaluateHarvest(state: ItemState, data: CraftDataContext, params: ModuleParams): ExpectedAttemptsResult {
  const m = params.method as HarvestMethod
  const def: HarvestCraft | null = harvestCraft(m.craft, m.tag)
  if (!def) return fail(`"${m.tag}" is not a Harvest-craftable tag for ${m.craft}`)
  // League gate (per-craft): Crystallised Rancour reforges are Mirage-only.
  if (def.league && !isLeagueActive([def.league], data.currentLeague)) {
    return fail(`Harvest ${def.tag} reforge is league-specific (${def.league}, uses Crystallised Rancour) — not active in "${data.currentLeague}"`)
  }
  const modTag = HARVEST_TAG_TO_MODTAG[def.tag]
  const lifeforce = LIFEFORCE_ITEM[def.colour]
  const desired = params.desired[0]
  const baseTags = new Set(state.tags)
  const extra = def.rancour ? [{ name: RANCOUR_ITEM, category: 'currency', qty: def.rancour }] : undefined
  const notes: string[] = [`Harvest ${def.kind} ${def.tag} — ${def.colour} Lifeforce ×${def.amount}${def.rancour ? ` + ${def.rancour} Crystallised Rancour (Mirage)` : ''}${def.sacred ? ` + ${def.sacred} Sacred` : ''}.`]
  if (def.costConfidence === 'low') notes.push('⚠ this craft\'s lifeforce amount is unconfirmed (low-confidence).')

  const locks = !!(state.meta.lockPrefixes || state.meta.lockSuffixes)
  if (locks && m.craft === 'reforge') {
    notes.push('Harvest reforge RESPECTS "cannot be changed" — it rerolls only the unlocked side; the locked side is kept (safe).')
  }

  if (!desired) return fail(`Harvest ${m.craft} needs a target mod`)
  const slot = desired.slot

  // ── reforge: reroll all, ≥1 of [tag] guaranteed (ignores locks) ───────────
  if (m.craft === 'reforge') {
    const pool = buildSlotPool(data.mods, baseTags, state.ilvl, slot, { meta: nonLockMeta(state) })
    const { share, tagPoolSize } = tagShare(pool, modTag, desired)
    if (tagPoolSize === 0) return fail(`no ${def.tag} ${slot} mods can roll on this base`)
    if (share <= 0) return fail(`${desired.label} is not in the ${def.tag} pool for this base/ilvl`)
    notes.push(`P(${desired.label} | ${def.tag} guaranteed) = ${(share * 100).toFixed(1)}% (share of the ${def.tag} ${slot} pool).`)
    return {
      method: `harvest reforge ${def.tag}`, supported: true, expectedAttempts: 1 / share, perAttemptProb: share,
      consumables: [], lowConfidence: true,
      blueprint: { label: 'harvest', steps: [{ kind: 'keep-trying', label: `Harvest reforge ${def.tag}`, p: share, consumable: { name: lifeforce, category: 'currency' }, qty: def.amount, extra }] },
      notes,
    }
  }

  // ── augment: add a [tag] mod to an open slot (reads BLOCKED groups) ────────
  if (openSlots(state, slot) <= 0) return fail(`no open ${slot} slot to augment (or it is locked)`)
  const usedGroups = new Set<string>([...groupsPresent(state), ...state.blockedGroups])
  const pool = buildSlotPool(data.mods, baseTags, state.ilvl, slot, { usedGroups, meta: nonLockMeta(state) })
  const { share, tagPoolSize } = tagShare(pool, modTag, desired)
  if (tagPoolSize === 0) return fail(`no ${def.tag} ${slot} mods can be augmented (after blocking)`)
  if (share <= 0) return fail(`${desired.label} can't roll here (blocked out or wrong base)`)
  const deterministic = share >= 0.999
  notes.push(
    deterministic
      ? `Pool blocked down to ${desired.label} → DETERMINISTIC augment (P=100%).`
      : `Open ${def.tag} pool → P(${desired.label}) = ${(share * 100).toFixed(1)}% per augment (block more groups to force it).`,
  )
  // Sacred + Rancour are consumed per augment use → folded into the same step's cost via `extra`.
  const augExtra = [...(def.sacred ? [{ name: LIFEFORCE_ITEM.Sacred, category: 'currency', qty: def.sacred }] : []), ...(extra ?? [])]
  const lf: PlanStepBlueprint = deterministic
    ? { kind: 'fixed', label: `Harvest augment ${def.tag}`, consumable: { name: lifeforce, category: 'currency' }, qty: def.amount, extra: augExtra }
    : { kind: 'keep-trying', label: `Harvest augment ${def.tag}`, p: share, consumable: { name: lifeforce, category: 'currency' }, qty: def.amount, extra: augExtra }
  return {
    method: `harvest augment ${def.tag}`, supported: true, expectedAttempts: 1 / share, perAttemptProb: share,
    consumables: [], lowConfidence: true, blueprint: { label: 'harvest', steps: [lf] }, notes,
  }
}

function outcomes(state: ItemState, params: ModuleParams, r: ExpectedAttemptsResult): OutcomeDistribution {
  if (!r.supported) return { outcomes: [{ p: 1, state }], notes: [r.reason ?? 'unsupported'] }
  const p = Math.min(1, Math.max(0, r.perAttemptProb))
  const t = params.desired[0]
  const hit = t ? withAffix(state, { modId: t.modId ?? t.group ?? t.label, group: t.group ?? t.modId ?? t.label, slot: t.slot }) : state
  return p >= 1 ? { outcomes: [{ p: 1, state: hit }] } : { outcomes: [{ p, state: hit }, { p: 1 - p, state }] }
}

export const harvestModule: CraftModule = {
  id: 'harvest',
  title: 'Harvest (lifeforce)',
  arity: 1,
  respectsLocks: respectsLock('harvest'), // RESPECTS "cannot be changed" (single source: lockMatrix)
  evaluate: (inputs: InputSet, data, params) => evaluateHarvest(inputs[0], data, params),
  applicable: (inputs: InputSet, data, params): Applicability => {
    const r = evaluateHarvest(inputs[0], data, params)
    return { ok: r.supported, reason: r.reason, slots: params.desired[0] ? [params.desired[0].slot] : undefined }
  },
  outcomes: (inputs: InputSet, data, params) => outcomes(inputs[0], params, evaluateHarvest(inputs[0], data, params)),
  cost: (inputs: InputSet, data, params) => {
    const r = evaluateHarvest(inputs[0], data, params)
    return { steps: r.blueprint?.steps ?? [], lowConfidence: true, notes: [HARVEST_PROVENANCE] }
  },
  toRiskSteps: (inputs: InputSet, data, params) => evaluateHarvest(inputs[0], data, params).blueprint?.steps ?? [],
}
