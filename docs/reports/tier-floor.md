# Report — tier-floor target semantics

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 362 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

The flag, fixed: the goal test was **exact-modId** — a "T1 Life" target was satisfied *only* by exact T1, so
the solver costed **P(exact top tier)** and overstated the price, hiding the cheap good-enough version. Real
crafting intent is "tier T **or better**." This adds an **opt-in tier floor** (`minTier`) so a target means
"this group at tier ≥ floor," and the goal test, roll probability, cost, and buy-side **all honor it**. The
default stays **exact** (parity byte-identical). One concern (floor semantics). Clean-room; analysis-only.

## Lead

- **Opt-in `minTier` widens a target from "exact tier" → "this group at tier-or-better."** Absent `minTier` ⇒
  exact modId (unchanged, parity-safe). Present ⇒ the **modId still identifies the group**; the floor widens
  the accepted identities *within* that group to tier ≤ floor (1 = best; a T2-floor is satisfied by T1 **or**
  T2, never T3). Added to `DesiredMod` ([craftMethods.ts](../../src/services/craftMethods.ts)), `ModTarget`
  ([modWeightIndex.ts](../../src/services/modWeightIndex.ts)), and `SpecificMod`
  ([solver.ts](../../src/services/solver.ts)).
- **Probability is now P(tier-or-better), not P(exact top tier).** `modRollProbability` derives the group, then
  sums the weights of the group's **qualifying tiers** (tier ≤ floor) over the same-affix pool. Live on a
  Two-Stone Ring `IncreasedLife` (8 tiers, 1000w each): P(exact T1) = **0.0169**, P(≤T2 floor) = **0.0338**
  (T1+T2), P(≤T3) = **0.0506**, P(whole group) = **0.135** — monotone, bracketed by exact-T1 and whole-group.
- **Cost reflects the floor → materially cheaper.** Feeding the floored probability through the alt-regal
  producer: exact T1 = per-attempt **0.0115**, **14.3c**; ≥T2 = per-attempt **0.0230**, **8.6c**. Higher
  per-attempt P ⇒ fewer attempts ⇒ ~40% cheaper for the same stat at a good-enough tier.
- **The good-enough-vs-perfect tradeoff is surfaced.** The same stat as two plans, cost gap visible:
  `≥T2 → alt → regal · rankChaos 15.8` vs `exact T1 → alt → regal · rankChaos 28.8`. The caller can now *see*
  the cheap version the exact-only goal test was hiding.
- **Goal test honors the floor.** A present **T2** satisfies a ≥T2 target ⇒ search depth **0** (already met, no
  work). A present **T3** does **not** ⇒ depth **>0** (the search must still produce a qualifying tier).
- **Buy-side honors the floor with no code change.** The rare-comparables pricing is text/pseudo-based; the
  floored target's `label` ("IncreasedLife ≥ T2") drives `estimateRarePriceLive`, so comparables are matched
  on the tier-or-better variant (cheapest qualifying tier), not an exact-T1-only filter.
- **Default exact = parity.** A no-floor modId target's probability is still exact-tier-weight / pool, and the
  matcher's exact path is byte-identical — all 362 prior tests pass, parity snapshot unchanged.

## What changed

| File | Change |
| --- | --- |
| [craftMethods.ts](../../src/services/craftMethods.ts) | `minTier?` on `DesiredMod`; `tierRank(pool, group)` (dense rank by `required_level` desc, 1=best) + tier-aware `matcher(d, pool)`; all 6 matcher call sites thread the pool. Exact path (no `minTier`) keys on modId/group as before. |
| [modWeightIndex.ts](../../src/services/modWeightIndex.ts) | `minTier?` on `ModTarget`; `modRollProbability` derives the group (from `group` or `modId`) and, when `minTier` is set, sums the qualifying tiers' weights (tier ≤ floor) — P(tier-or-better). |
| [solver.ts](../../src/services/solver.ts) | `minTier?` on `SpecificMod`; floored `modPresent` (group match + `tier ≤ floor`); `affixOf` carries `tier: minTier` so produced affixes satisfy the floor. |
| [modProducer.ts](../../src/services/modProducer.ts) | Documented `TargetCandidate.tier` as the **floor handle**: a caller passes a candidate's `tier` as `minTier` (the UI good-enough control). |
| [scripts/validate-tier-floor.mjs](../../scripts/validate-tier-floor.mjs) + `package.json` | `npm run validate:tier-floor` — floor probability, floor cost, tradeoff, goal test, buy-side note, default-exact, resolver handle, on **live** data. |
| [test/tierFloor.test.ts](../../test/tierFloor.test.ts) | 7 assertions on synthetic 3-tier data: tier ranks, floor probability (exact < ≥T2 < whole-group), floor cost (cheaper), goal test (T2 met / T3 not), tradeoff, default unchanged. |

## Tier convention

`minTier` is a **floor on rank**, 1 = best (highest `required_level`). "≥ floor" means *at-or-better than the
floor tier*, i.e. **tier rank ≤ `minTier`**. T1 = the top roll; a T2-floor accepts {T1, T2}. The rank is derived
the same way in all three modules (dense rank of distinct `required_level`, descending) so the matcher, the
weight index, and the solver agree.

## Confidence & flag-don't-invent

- The floor reuses the **real** spawn weights already in the per-base index — no invented numbers. Confidence
  still propagates as the **min over steps**.
- Bench-cost data is pre-3.28 (reads ~0c) and still distorts ranking in the 2–15c band; the floored vs exact
  *gap* is robust to this because both share the same bench inputs, but absolute totals carry the standing bench
  flag (Eric's parallel data refresh).

## Follow-ups

- The resolver returns per-tier candidates; the UI per-mod picker is expected to let the user pick a tier
  **and** opt into "or better" (emit `minTier` = that candidate's tier). The engine↔UI contract is ready.
- An `excluded` floor ("none of this group at tier ≥ floor") shares the same matcher and is honored
  symmetrically; covered by the matcher change, not separately benchmarked here.
