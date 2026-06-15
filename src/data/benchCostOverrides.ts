/**
 * data — bench-cost override seam (verified current-patch amounts).
 *
 * The RePoE `crafting_bench_options` export carries each bench craft's cost as a
 * currency-metadata-path → amount dict (e.g. `CurrencyAddModToRare: 2`), which
 * `benchCrafting.normalizeBench` maps to an economy currency name + count and
 * `craftCost` prices LIVE from the currency feed. Those amounts are taken as-is and
 * are NOT independently re-verified against the current patch.
 *
 * Diagnosis (docs/reports/bench-cost-fix.md): the cost data is present, parsed, and
 * priced live — not a parse bug. The verifiable subset (meta: multimod/lock 2 Divine,
 * cannot-roll 1 Divine) matches current in-game values; per-mod bench amounts are
 * plausible but unverified. This file is the seam for correcting any recipe whose real
 * cost has been confirmed (e.g. from poedb): add it keyed by the RePoE mod id and
 * `normalizeBench` prefers the override; live pricing is unchanged (still
 * amount × live currency chaos). Empty ⇒ use the export's amount unchanged (parity-safe).
 *
 * Schema: { [repoeModId]: { costName, costAmount } }
 *   costName   — economy currency name (must match a feed currency, e.g. 'Exalted Orb';
 *                see BENCH_CURRENCY_NAMES values in benchCrafting.ts)
 *   costAmount — integer count of that currency
 */
export interface BenchCostOverride {
  costName: string
  costAmount: number
}

/** Verified per-recipe bench costs, keyed by RePoE mod id. Empty until sourced. */
export const BENCH_COST_OVERRIDES: Record<string, BenchCostOverride> = {
  // e.g. 'HelenaMasterIncreasedLife6': { costName: 'Exalted Orb', costAmount: 2 },
}
