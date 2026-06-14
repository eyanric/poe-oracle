# Report — bench + meta-crafting (make the brick engine real)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, gates green (169 tests).

The risk engine's brick/`slam` machinery shipped but was only exercised synthetically. This track adds
the first real methods that use it — **bench crafts, meta-mods, and the exalt slams they protect or
expose** — so the same slam now reads `high-brick` unprotected and safe when protected. Plus two quick
commits. No Harvest, no scanner, no Track B, no automation. Clean-room; layering held.

## ⚠ Lead finding — what the cost data reflects (most likely to be stale)

**Source:** RePoE `crafting_bench_options` export (the spec's anticipated source; it IS present).
Field `actions.add_explicit_mod` = the crafted mod id; `cost` is keyed by currency metadata path.
Structure (which mod, slot, item-class, currency *kind*) is reliable: **723 bench crafts + 5 meta-mods**
(multimod, prefixes/suffixes-cannot-be-changed, cannot-roll-attack/caster) all load and join cleanly.

**But the cost AMOUNTS read as PRE-3.28:**
- multimod & "cannot be changed" = **2 Divine**; "cannot roll attack/caster" = **1 Divine**;
- regular bench mods in **alt / chaos / alchemy** amounts (e.g. +Life = 2 Orbs of Alteration).

The 3.28 Mirage patch notes explicitly say *"Crafting bench costs have been standardized and now
generally cost 4 Exalted Orbs"* (and Exalts made more common). The export does **not** reflect that
rework — it shows the older Divine/alt/chaos costs. So **every bench/meta cost is flagged
low-confidence** and surfaced as such (a `STALE_COST_NOTE` on every result); I did **not** guess "4
Exalted." Structure trustworthy, amounts stale. This is the headline caveat.

## Commits

### Commit 1 — CV-based determinism
Re-based the determinism score from cost-share ("how much spend is locked in") to the **coefficient of
variation** of the cost distribution ("how random is the outcome"): `score = (1 − brickPenalty)/(1 + CV)`.
`CostDistribution` now carries `std` (closed-form `c·√(1−p)/p`; empirical for Monte Carlo). CV 0 → 1.0
(essence), moderate CV → mid (grind ~0.57), brick's fat tail × brickPenalty → low (~0.1). Inputs
(`cv/std/mean/brickPenalty`) stay exposed. *Honest note:* for a cheap geometric craft where a guaranteed
terminal is a big cost share, CV can read it as MORE cost-predictable than cost-share did — CV measures
cost-outcome predictability, and the risk **category** remains the gamble-ness quick-read.

### Commit 2 — backlog note
`docs/backlog.md`: unique pricing by required roll/variant in build-cost (deferred; signal already in
`ParsedPob.items`).

## The track

### Phase 1 — data ([services/benchCrafting.ts](../../src/services/benchCrafting.ts))
`normalizeBench` joins each bench option to its RePoE mod → `BenchCraft { modId, slot, label,
itemClasses, costName, costAmount, meta }`; meta-mods detected by id pattern; currency metadata paths
mapped to economy names for live pricing. All costs flagged low-confidence (above).

### Phase 2 — methods ([craftMethods.ts](../../src/services/craftMethods.ts) → `craftRisk` plans)
Methods emit an unpriced **PlanBlueprint** that `craftCost` prices into a `CraftPlan`:
- **bench** → `fixed` steps (guaranteed mods). Deterministic.
- **multimod** → a `fixed` meta step + N `fixed` bench mods. Deterministic.
- **slam** → optional base value (`fixed`, the value-at-risk) + optional protective meta (`fixed`) + an
  exalt `slam`. **The crux:** `protect` sets the slam `recoverable` — locked affixes survive a miss, so
  the same slam is a brick unprotected and a recoverable re-slam protected. pSuccess comes from the
  open-slot weight model.

### Phase 3 — exposed in `calc_craft_cost`
`bench` / `multimod` / `slam` are supported methods (tool inputs `benchMods`, `protect`,
`baseValueChaos`); the priced plan runs through the risk engine + risk-adjusted verdict. The output makes
the protection effect visible (category + value-at-risk move).

## Validation (LIVE — `npm run validate:bench`, Mirage)

| Case | Result |
|---|---|
| **Pure bench** (+Life on Vaal Regalia) | **deterministic**, determinism 1.0, **zero brick**, ~0c (2 alts) ✅ |
| **Multimod** (Life + Fire + Cold res) | **deterministic**, total **1176c = 2.00 div** — matches the known **~2-divine multimod** figure (pre-3.28) + small bench costs ✅ |
| **Exalt slam — UNPROTECTED** (base 1000c) | category **high-brick**, **value-at-risk 1005c (1.71 div)**, determinism **0.11**, **p90 18.82 div** (rebuild-on-brick tail) |
| **Exalt slam — PROTECTED** (suffixes locked) | category **deterministic**, **0 bricks** (VaR gone), determinism **1.0**, **p90 3.70 div** |

**The flip is the feature:** the *same* exalt slam goes `high-brick → deterministic` and its p90 collapses
**18.82 div → 3.70 div** purely by adding the protective meta. Unit-tested (`craftCost.test.ts` "THE CRUX")
and live-validated.

### Costs the source couldn't confirm
All bench/meta amounts (multimod 2 div, bench alt/chaos/alch) — flagged low-confidence; the 3.28 "~4
Exalted standardized" amounts are not in the export. The slam's exalt cost + base value price live.

## Gate status
typecheck ✅ · lint ✅ (layering green) · **169 tests** ✅ (+7: benchCrafting 4, craftCost bench/multimod/slam 3)
· build ✅ · `validate:bench` ✅ (live).

## Out of scope / next
- No Harvest (next method track — most patch-volatile, separate sourcing). No scanner (needs these
  methods first). No Track B; no automation.
- **Follow-up worth scheduling:** confirm/patch the 3.28 bench/meta cost amounts (the one stale piece) —
  e.g. an override table for the "~4 Exalted" standardized costs, or a fresher source.
