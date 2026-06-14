/**
 * services — Anointing (Tier-1 deterministic module B).
 *
 * Three Blight oils combine into a specific Notable passive as an amulet enchantment.
 * Deterministic (P=1): cost = the three oils, priced live (oils now in the economy snapshot).
 *
 * ⚠ The notable→3-oil recipe table is NOT in the repoe-fork export (it is Blight anoint data).
 * The full ~455-combination table must be sourced from poedb/PoE wiki — here it is a small CURATED,
 * flagged SEED. To stay useful without inventing recipes, the module also accepts an EXPLICIT
 * 3-oil list and prices it directly (so any anoint can be costed; the seed only saves a lookup).
 *
 * Variants (flagged, NOT modelled here): ring anointing (Blight-ravaged maps, different oils),
 * cluster-jewel anoints (one oil), Blight-unique enchant pools (separate pools), and the Mirage
 * Cord Belt (anointable as an amulet — would league-gate to Mirage). Amulet anoint is the core.
 */
import type { ItemState } from './itemState'
import type { CraftModule, InputSet, ModuleParams, OutcomeDistribution } from './craftModule'
import type { ExpectedAttemptsResult, PlanStepBlueprint } from './craftMethods'

/** Oil tiers, cheapest → priciest (3 of a tier vendor up to 1 of the next). */
export const OIL_TIERS = [
  'Clear', 'Sepia', 'Amber', 'Verdant', 'Teal', 'Azure', 'Indigo',
  'Violet', 'Crimson', 'Black', 'Opalescent', 'Silver', 'Golden',
] as const
export type Oil = (typeof OIL_TIERS)[number]
const oilItem = (o: Oil): string => `${o} Oil`
const isOil = (s: string): s is Oil => (OIL_TIERS as readonly string[]).includes(s)

/**
 * ⚠ CURATED SEED (PoE wiki) — not in the data export; the full notable→recipe table must be
 * sourced from poedb. Entries here are confirmed; for anything else, pass explicit `oils`.
 */
export const ANOINT_RECIPES: Record<string, [Oil, Oil, Oil]> = {
  'Whispers of Doom': ['Golden', 'Golden', 'Golden'], // confirmed: +1 curse (the iconic anoint)
}

const ANOINT_BASE_TAG = 'amulet'

function resolveOils(method: { notable?: string; oils?: string[] }): { oils: Oil[]; source: string } | { error: string } {
  if (method.oils && method.oils.length) {
    if (method.oils.length !== 3) return { error: `an anoint is exactly 3 oils (got ${method.oils.length})` }
    const bad = method.oils.filter(o => !isOil(o))
    if (bad.length) return { error: `unknown oil(s): ${bad.join(', ')} — use ${OIL_TIERS.join('/')} (without " Oil")` }
    return { oils: method.oils as Oil[], source: 'explicit oils' }
  }
  if (method.notable) {
    const recipe = ANOINT_RECIPES[method.notable]
    if (!recipe) return { error: `"${method.notable}" not in the curated seed recipe table — supply the 3 oils explicitly, or populate the table from poedb (recipes are not in the data export)` }
    return { oils: [...recipe], source: 'seed recipe table' }
  }
  return { error: 'name a specific notable (seed table) or supply 3 oils — abstract anoint is unsupported' }
}

/** Aggregate the 3 oils into priced consumables (same oil ⇒ qty). */
function oilConsumables(oils: Oil[]): { name: string; qty: number; category: string }[] {
  const counts = new Map<string, number>()
  for (const o of oils) counts.set(oilItem(o), (counts.get(oilItem(o)) ?? 0) + 1)
  return [...counts].map(([name, qty]) => ({ name, qty, category: 'oil' }))
}

function evalAnoint(state: ItemState, params: ModuleParams): ExpectedAttemptsResult {
  const method = params.method as { kind: 'anoint'; notable?: string; oils?: string[] }
  const title = 'anoint'
  if (!state.tags.includes(ANOINT_BASE_TAG)) {
    return { method: title, supported: false, reason: `amulet anoint applies to amulets (base tags: ${state.tags.join(', ')}). Ring/cluster/Cord-Belt anoint variants are flagged, not modelled.`, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] }
  }
  const resolved = resolveOils(method)
  if ('error' in resolved) {
    return { method: title, supported: false, reason: resolved.error, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] }
  }
  const label = method.notable ? `"${method.notable}"` : resolved.oils.join(' + ')
  return {
    method: `anoint ${label}`,
    supported: true, expectedAttempts: 1, perAttemptProb: 1,
    consumables: oilConsumables(resolved.oils),
    lowConfidence: true,
    notes: [
      `Deterministic (P=1): anoint ${label} = ${resolved.oils.map(oilItem).join(' + ')} (${resolved.source}).`,
      '⚠ The notable→recipe table is a curated seed (not in the data export) — pass explicit oils for any notable not seeded.',
    ],
  }
}

const stepsFrom = (r: ExpectedAttemptsResult): PlanStepBlueprint[] =>
  r.supported ? r.consumables.map(c => ({ kind: 'fixed', label: c.name, consumable: { name: c.name, category: c.category }, qty: c.qty })) : []

export const anointModule: CraftModule = {
  id: 'anoint', title: 'Anoint (amulet, 3-oil recipe)', arity: 1, respectsLocks: true,
  evaluate: (inputs: InputSet, _data, params) => evalAnoint(inputs[0], params),
  applicable: (inputs: InputSet, _data, params) => { const r = evalAnoint(inputs[0], params); return { ok: r.supported, reason: r.reason } },
  outcomes: (inputs: InputSet, _data, params): OutcomeDistribution => {
    const r = evalAnoint(inputs[0], params)
    return r.supported ? { outcomes: [{ p: 1, state: inputs[0] }] } : { outcomes: [{ p: 1, state: inputs[0] }], notes: [r.reason ?? 'unsupported'] }
  },
  cost: (inputs: InputSet, _data, params) => { const r = evalAnoint(inputs[0], params); return { steps: stepsFrom(r), lowConfidence: r.lowConfidence } },
  toRiskSteps: (inputs: InputSet, _data, params) => stepsFrom(evalAnoint(inputs[0], params)),
}
