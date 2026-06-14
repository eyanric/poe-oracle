# Report — NNN-ladder cost test (GloomyC double-block shield)

**Date:** 2026-06-14 · **League:** Settlers (for the test; recombine is gated off in Mirage) · **Status:** shipped, gates green (223 tests).

Uses the published double-block-shield ladder (5×T1: **3 prefix + 2 suffix on an INT Spirit Shield**) to
(a) calibrate the recombine model against the guide and (b) build the **multi-stage expected-cost-with-
failure-reproduction** primitive. This **evaluates one fixed ladder** — it is NOT the solver; it's the cost
function the solver will call. Clean-room; analysis-only.

## Lead — rates vs guide, total cost, the upper-bound caveat

- **Model overshoots the guide on the flagged Stage-A table.** With the default (representative) Stage-A
  count distribution: **rung 2 ≈ 60%** (guide ~30%) and **rung 3 ≈ 57%** (guide ~14%). A **Stage-A
  sensitivity** sweep with a less top-heavy table gives **rung 2 ≈ 20%, rung 3 ≈ 14%** — rung 3 lands on
  the guide. **Finding: the Stage-A count distribution is the dominant lever and is currently mis-calibrated
  (it over-weights high mod counts).** This is the first independent empirical check on that flagged table —
  it needs the real GGG data.
- **Total expected cost (UPPER BOUND), per-rung:** with default (model) rates ≈ **742c (1.3 div)**, ~16
  single-mod donors; with guide-calibrated rates ≈ **7562c (13.3 div)**, ~**165 single-mod donors**. The
  donor count is the real lesson ("you have to make a LOT of bases").
- **Upper bound, stated plainly:** the model assumes a failed recombine loses ALL its inputs. In reality a
  failed base often still carries desired mods and can be re-padded and re-smashed, so the true cost is
  **lower**. Partial-salvage is a future refinement.

## Part A — calibration vs the guide

- **NNN classification is data-grounded:** on the real Spirit Shield (`int_armour, focus, shield, …`),
  `"(15-26)% increased Armour"` (which rolls on a Splintered Tower Shield) has `isNative(Spirit Shield) =
  false` → a valid NNN pad. STR/DEX shield mods are the NNN sources for the INT target, derived from the
  pools, not a hand list.
- **Rung rates** (representative donor compositions, flagged):

  | Rung | Model (default Stage-A) | Guide | Model (conservative Stage-A) |
  |---|---|---|---|
  | rung 1 (two-mod donor) | 95% | — | 95% |
  | rung 2 (intermediate 3p) | **60%** | ~30% | **20%** |
  | rung 3 (final 3p2s) | **57%** | ~14% | **14%** |

- **Cross-check:** rung 3 computed via the NNN-aware `analyzeRecombine` module (built item-states) = 57%,
  identical to the direct `pSlotSurviveNNN` composition — the module and the math agree.
- **Why the overshoot:** the default Stage-A table puts ~0.6 weight on the max count for a 6-pool, so
  perfectly-padded donors (only the desired are native) keep their mods too easily. The conservative table
  reproduces the guide's rung 3 — confirming **Stage-A is the driver**, not the selection math (which is
  exact) or the NNN logic.

## Part B — multi-stage cost with failure-reproduction (the primitive)

[services/ladderCost.ts](../../src/services/ladderCost.ts) — `evaluateLadder(rungs)`: bottom-up
`costPerUnit = (Σ input.count·cost[lower] + recomb + extra) / pSuccess`; top-down expected units consumed
(`unitsProduced / pSuccess × count`); per-rung own-cost `contribution` (Σ contributions = total, asserted).
Unit-tested (4). The GloomyC ladder is wired in the script (a test, not a shipped tool); the primitive is
the reusable deliverable.

The ladder (rung 0 → 3): **rung 0** unit = alt→regal single mod (reused from the currency cost model, live
≈ 1c); **rung 1** adds NNN slam-padding (bench-block + slam, representative parameter); **rung 2/3** each
add a recombinator (parameter). Per-rung breakdown (guide-calibrated run): the bulk of cost is **rung 1 ×
the many intermediate donors needed** (the padding cost paid on every two-mod donor), not the final smash.

**Flagged parameters (not fabricated as live):** recombinator currency doesn't price in Mirage (Settlers
mechanic) → taken as a representative parameter (20c); rung-1 padding likewise (60c). The rate calibration
(Part A) dominates the total far more than these.

## Validation (LIVE — `npm run nnn:ladder`)
Real Spirit Shield + STR/DEX shield pools for NNN; rung 3 cross-checked module-vs-math; Stage-A sensitivity
run; cost cascaded under both rate sets with per-rung breakdown + donor count; upper-bound + flags printed.

## Gate status
typecheck ✅ · lint ✅ (layering) · **223 tests** ✅ (+4 ladderCost) · build ✅ · `nnn:ladder` live ✅ ·
parity unaffected (additive).

## Out of scope / next
Not the solver — this evaluates one hand-specified ladder and ships the cost-composition primitive the
solver reuses. No path search, no memory strands, no Track B, no automation. Carried, now empirically
sharpened: **the Stage-A count distribution needs real data** (it drives the rate, and the rate drives the
cost); partial-salvage refinement to the upper-bound cost. Per the roadmap, the Tier-1 coverage cluster
(eldritch / influence / catalysts / anointing) remains the next coverage work.
