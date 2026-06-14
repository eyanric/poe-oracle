# Report — Recombinators v2 (non-native modifiers / NNN)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, gates green (224 tests, parity intact).

Refines the arity-2 recombine module with **non-native natural modifiers (NNN)** — the mechanic behind
high-end multi-T1 brute-force recombination (the NNN-ladder). PoE 1 Settlers ruleset. Scope = a single
NNN-aware recombine; the multi-step ladder is solver territory. Clean-room; analysis-only; no automation.

## Lead — NNN derived from data, the lever, parity

- **`isNative` is data-derived, not a hand list** ([services/modLegality.ts](../../src/services/modLegality.ts)):
  a mod is native to a base iff the base's tags hit the mod's spawn-weights with nonzero weight **and**
  ilvl ≥ required level. Because influence-gated mods key their spawn-weights on influence tags, passing a
  base-tag set that includes the chosen base's influence tags also covers influence legality. Reusable —
  put where Awakener's Orb (output legality) and Synthesis (fractured-fuse) will share it.
- **The lever works** (live): wanting **3 prefixes**, an unpadded combine reads **P(target) 30.0%**; padding
  the donor with **3 non-native mods** reads **60.0%** (`nnnLever: 30% → 60%`). The NNN junk inflates the
  Stage-A count, self-rejects, and frees the extra count-slots for the desired natives — exactly the
  technique players exploit to force >3 desired mods.
- **Parity:** the 9-case method-matrix snapshot is **byte-identical**; the NNN refactor is backward-compatible
  (all-native ⇒ identical to v1).

## What was modeled

- **Reject-and-redraw, NNN-aware survival** ([services/recombine.ts](../../src/services/recombine.ts)):
  `pSlotSurviveNNN(nTotal, mNative, d)` = Σ_c P(count=c | **nTotal**) · C(mNative−d, c′−d)/C(mNative, c′),
  c′ = min(c, mNative, 3). Stage-A count keyed on the **total** pool (padding raises it); Stage-B selects
  from the **native** subset only (NNN self-reject) — **exact** given the (flagged) Stage-A table.
  `pSlotSurvive(n,d) = pSlotSurviveNNN(n,n,d)` (v1 behaviour preserved).
- **Both 50/50 base-choice branches:** legality flips with the chosen base, so `analyzeRecombine` computes
  P(target prefix/suffix) over each branch and averages. A mod **native to base A but not base B** is handled
  per branch — validated: with legality data a desired mod illegal on the other base zeroes that branch
  (P halved vs the no-data case).
- **Fractured retention** tied to base choice: a fractured mod is kept **only if its origin item is the
  chosen base** (the other input's fractured mods are dropped from the pool in that branch). Validated: a
  fractured desired survives only in its own base's branch (P ≈ 0.5 × that branch). ⚠ The "fractured can
  carry an extra mod beyond the normal count" interaction with Stage-A is **flagged uncertain** and NOT
  modeled (noted, not invented).
- **Exclusive + NNN compose, not conflict:** the existing ≤1-exclusive rule still fires (two exclusive
  desired ⇒ guaranteed brick) and runs alongside NNN padding (one exclusive + NNN pad ⇒ supported, NNN
  lever applies). Both are the levers that force >3 desired; unit-tested together.
- **Surfaced the lever:** `RecombineEstimate.nnnLever { withoutPad, withPad }` + a note "padding raises
  P(target) from X% to Y%" + shown in the `calc_recombine` tool.

## Confidence / flags (unchanged discipline)

- **Stage-A count distribution** — low-confidence representative table (not in the export; community
  small-sample). Unchanged from v1.
- **NNN replacement semantics** (redraw from native-only remainder; interaction with the count) — the
  documented reject-and-redraw is implemented and kept `costConfidence:'low'`.
- **Exclusive-mod set** — no clean data flag (67 scattered text hits, not a tag); caller-supplied via
  `Affix.exclusive`, flagged.
- **NNN classification** — data-derived via `isNative` when the mod resolves in the export; otherwise the
  caller's `Affix.nonNative` flag (symmetric-pad fallback).

## Validation (LIVE — `npm run validate:recombine`)

- **`isNative` on real data:** spell suppress → native on **Leather Cap** (helmet, evasion) = true, on
  **Vaal Regalia** (INT body) = false — shield-exclusion honoured (it correctly reads false on a buckler). ✅
- **NNN padding lever:** want 3 prefixes → unpadded **30.0%** vs padded(3 NNN) **60.0%**. ✅
- Plus v1 checks still green: concrete combine (P 45% / brick 55%, ilvl 84, independent pools), exclusive
  collision brick, league-gating excludes recombine in Mirage, recombinator currency flagged unpriced.

Unit tests: `isNative` INT/DEX/ilvl (3); recombine NNN lever, padded-vs-unpadded `analyzeRecombine`,
base-branch legality flip (data-derived), fractured retention (0.45), exclusive+NNN composition (5);
all v1 recombine tests still pass.

## Gate status
typecheck ✅ · lint ✅ (layering) · **224 tests** ✅ (+13: modLegality 3, recombine NNN 5, +existing) ·
build ✅ · `validate:recombine` live ✅ · **parity snapshot byte-identical**.

## Out of scope / next
The **NNN-ladder sequence** (single → two → final, chained recombinations) is **solver territory** — this
makes each rung's probability correct so the solver can chain them. No solver / memory-strands / Track B /
automation here. Per the roadmap, the Tier-1 coverage cluster (eldritch / influence / catalysts / anointing)
is the next coverage work. Carried flags: confirm recombinator 3.28 availability; real Stage-A distribution
+ exclusive-mod set; the fractured +1-count interaction.
