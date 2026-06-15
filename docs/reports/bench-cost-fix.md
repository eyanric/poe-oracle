# Report — bench-cost data fix (diagnose → correct)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 365 tests ✓ · build ✓ · **parity byte-identical**). Pushed to `origin/main`.

Diagnosis-first investigation of the standing flag *"crafting-bench costs read ~0c, distorting craft-vs-buy
verdicts and plan totals."* One concern (bench-cost correctness). Clean-room; analysis-only.

## Lead — the "~0c bug" premise is largely a misdiagnosis

- **The cost data is PRESENT, correctly PARSED, and priced LIVE.** `crafting_bench_options.min.json` carries
  a `cost` dict per option (`{ <currency-metadata-path>: <amount> }`); **728/728** mod-adding crafts have a
  non-empty cost (all single-currency). [benchCrafting.ts](../../src/services/benchCrafting.ts) maps the path →
  economy currency name + count, and [craftCost.ts](../../src/services/craftCost.ts) prices it **live** as
  `amount × live currency chaos`. It already tracks the economy like everything else — **not** a parse bug,
  **not** a missing field.
- **It does not read literally 0c, and it scales by tier.** Live on a Ring +Life bench: `+(15-25) Life` =
  `1× Orb of Alteration` = **0.27c**; `+(41-55) Life` = `2× Orb of Alchemy` = **1.08c**; `+(41-45) Life` =
  `4× Chaos Orb` = **580c**. The cheap tiers are genuinely cheap (one basic orb) and the high tiers are
  genuinely expensive — the shape of a real bench-cost table. The "~0c" perception came only from the lowest,
  cheapest tiers (which a real player also gets for ~1 alteration).
- **The verifiable subset matches the current patch.** Meta costs read **multimod 2 Divine, lock 2 Divine,
  cannot-roll 1 Divine** — exactly the long-standing in-game values. This directly contradicts the old flag's
  claim that the export is uniformly "pre-3.28" and that 3.28 "standardized bench to ~4 Exalted." That claim
  was **unsubstantiated** and the checkable data refutes it.
- **Conclusion: a SOURCING question, not a code defect.** The per-mod bench amounts are taken from the export
  as-is and have not been *independently re-verified* against the live patch. They are plausible (and the meta
  subset is confirmed current), but unverified. So the correct action — per flag-don't-invent — is **not** to
  fabricate "corrected" amounts (that would invent numbers), but to (1) make the flag accurate and (2) provide
  a clean seam for verified corrections.

## What changed (no numbers invented; parity byte-identical)

| File | Change |
| --- | --- |
| [data/benchCostOverrides.ts](../../src/data/benchCostOverrides.ts) **(new)** | The clean seam: `BENCH_COST_OVERRIDES: Record<modId, { costName, costAmount }>` (empty), with a documented schema. Verified per-recipe costs (e.g. sourced from poedb) go here keyed by RePoE mod id. |
| [services/benchCrafting.ts](../../src/services/benchCrafting.ts) | `normalizeBench(options, mods, overrides = BENCH_COST_OVERRIDES)` prefers an override's currency + amount over the export. Live pricing unchanged (still `amount × live currency chaos`). Corrected the file-header flag. |
| [services/craftMethods.ts](../../src/services/craftMethods.ts) | Rewrote `STALE_COST_NOTE` to the **accurate** flag: amounts are export-sourced + priced live, meta matches current values, per-mod amounts unverified, corrections live in `benchCostOverrides`. (Removed the unsubstantiated "~4 Exalted standardization" claim.) |
| [scripts/validate-bench-cost.mjs](../../scripts/validate-bench-cost.mjs) + `package.json` | `npm run validate:bench-cost` — diagnosis + realistic-cost + override-seam, on live data. |
| [test/benchCostOverride.test.ts](../../test/benchCostOverride.test.ts) **(new)** | 3 assertions: seam ships empty (parity-safe); export amount used with no override; a verified override replaces currency + amount. |

## Parity note

**Parity is byte-identical — and that is the correct outcome, not a skipped step.** The parity note in the
brief anticipated a parse bug whose fix would move numbers; the diagnosis found no such bug. The two code
changes are non-numeric by construction: the override map ships **empty** (so every bench cost is the export's
unchanged amount), and the flag text lives in `notes`, which the parity snapshot
([methodParity.test.ts](../../test/methodParity.test.ts)) does not capture (it snapshots `totalChaos`,
`consumables.chaosTotal`, `risk`, `verdict`, `lowConfidence`). Verified: `git status` shows **no `.snap`
changes**; all 41 prior test files pass unchanged. Numbers will only move when verified amounts are sourced
into `benchCostOverrides` — at which point the diff will be exactly those recipes.

## Validation (`npm run validate:bench-cost`)

| Check | Result |
| --- | --- |
| Diagnosis reported | file/field, 728/728 present, parsed + priced-live → **sourcing (unverified amounts), not a parse bug** |
| Bench cost realistic | non-zero, live, scales by tier (0.27c → 1.08c → 580c for +Life tiers) |
| No spurious dominance | the cheapest +Life bench wins on a **real** 0.27c (= 1 Orb of Alteration), not a 0c artifact |
| Verdict uses real bench | bench +Life estimate `totalChaos = 0.27`, `lowConfidence = true`, accurate flag note attached |
| Flag updated | re-scoped precisely (sourcing-gap on amounts; meta confirmed current); false "~4 Exalted" claim removed |
| Parity diff scoped | **byte-identical** (override empty; note not snapshotted) — documented above |
| No regression | 365 tests pass (+3 override seam); 41 prior files unchanged |

## Handoff / decision for you

- **The ball is in your court on sourcing.** The data is not broken; it's *unverified*. If you want tighter
  absolute totals, confirm the real per-recipe currency amounts (poedb) and drop them into
  `benchCostOverrides` keyed by mod id — pricing then tracks the feed automatically. If the export amounts are
  in fact current (the meta subset suggests the table is well-maintained), no further action is needed and the
  low-confidence flag can later be narrowed/removed.
- **Latent (out of scope, flagged):** 15 export options carry a multi-currency `cost` dict, but all are
  flask/enchant options with no `add_explicit_mod` — `normalizeBench` taking `Object.entries(cost)[0]` drops
  nothing for the mod-adding crafts we consume. Revisit only if flask-quality/enchant bench pricing is added.
- **Still pending (yours):** the **anoint** notable→3-oil recipe table; **synthesis** implicit pool. Next build
  after this: the **anoint producer**, then the **UI per-mod picker → modId/`minTier` `TargetSpec`**.
