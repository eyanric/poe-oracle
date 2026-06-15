# Report — Path Solver, increment 3b (unprotected cross-step reproduction)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 343 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

The algorithmic half of "increment 3". Since increment 2 the search composed **protect-then-proceed only**, so
a returned plan was a *safe upper bound* and the solver could **miss cheaper unprotected gambles**. This removes
that caveat: plan costing is generalized from "Σ per-step, protected only" to **expected-cost-with-reproduction**
over arbitrary sequences, so protected and unprotected plans compete on a **true expected cost**. No new
coverage. Clean-room; analysis-only.

## Lead

- **Reproduction term, generalized.** [src/services/solver.ts](../../src/services/solver.ts) — `planExpectedCost`
  is now Σ per-step **plus**, for each **destructive** step, the cost of **reproducing every secured desired
  mod it wipes**. "wipes" = present ∧ ¬(metamod-locked ∧ step respects locks). This generalizes `ladderCost`'s
  insight (a destructive step reproduces what it consumes) to a heterogeneous move sequence.
- **No regression on protected plans.** A protect-then-proceed plan's reproduction term is **0** by construction
  (the lock + a lock-respecting reforge wipe nothing) ⇒ cost **identical** to increment 2: validated `10 + 400 +
  20 = 430c`. All spine (7) + multi-step (7) + producer (10) + parity (9) tests pass unchanged.
- **`respectsLocks` honoured (the subtle one).** A plan that locks prefixes then applies a **lock-IGNORING**
  destructive move (Harvest reforge / fossil / scour) **still incurs reproduction** for the "locked" prefixes:
  `lock+chaos 430c` vs `lock+harvest 440c` (+10 = reproduce the wiped prefix). **⚠ Correction to the prompt:**
  in 3.28 **Chaos / Alt / Essence DO respect** "cannot be changed" (they reroll only the unlocked side) — only
  Harvest / fossils / scour ignore it. Modeled to the real mechanic (flagged), not the prompt's parenthetical.
- **Unprotected beats protected when it should, and protection still wins when it should.** Expensive 2-div
  lock vs cheap reproduction → **unprotected** plan returned (`40c` vs `430c`). Cheap lock vs expensive
  reproduction → **protected** stays on top (`35c` vs `620c`). Both are in the search space; b&b picks the
  genuinely cheaper.
- **Only destroyed mods reproduced** (additive steps → 0; fracture not tracked at plan level). **Closed-form ≈
  Monte-Carlo** (Δ ≈ 0% on every case). **Confidence propagation** unchanged (min over steps). **Parity
  byte-identical.**

## What was built

- **Move classification** — `PlanMove` gains `effect: 'additive' | 'destructive' | 'protective'` +
  `respectsLocks`. Destructive = reforge/scour/harvest/fossil/essence/alt/veiled-chaos/strand/eldritch-annul;
  lock-ignoring = harvest/fossil/scour; everything else additive/lock-respecting.
- **`planExpectedCost(moves, costSelector)`** — the reproduction-aware cost (mean + p90 bases). Replaces the
  raw Σ for ranking complete plans. The b&b bound now tracks the **true cost** (min `rankChaos`), pruning
  partials by their `accP90` (Σ, an admissible **lower bound** since reproduction only adds).
- **`expand` no longer skips destructive moves** over present desired — they're generated and correctly costed
  (the artificial protect-only restriction is gone), so unprotected plans compete.
- **`simulatePlanCost(moves)`** — a Monte-Carlo (geometric retries per step + reproduction) whose mean
  converges to `planExpectedCost` (the closed-form sanity check). The recombinator recipe keeps its own
  probabilistic per-attempt reproduction inside `ladderCost` (reused unchanged, MC-validated in nnn-ladder).

## Validation (`npm run validate:solver-reproduction` + `test/solverReproduction.test.ts`)

| Check | Result |
|---|---|
| No regression on protected plans | reproduction term 0 ⇒ `430c` (= increment 2); all prior tests pass ✓ |
| Unprotected beats protected | expensive 2-div lock `430c` vs unprotected `40c` → unprotected returned ✓ |
| Protection still wins | cheap lock `35c` vs expensive reproduction `620c` → protected on top ✓ |
| `respectsLocks` honoured | lock+chaos `430c` (respects) vs lock+harvest `440c` (ignores → reproduces) ✓ |
| Only destroyed mods reproduced | additive step → no reproduction (`15c`) ✓ |
| Termination + MC sanity | closed-form ≈ Monte-Carlo, Δ ≈ 0% on protected / harvest / unprotected ✓ |
| Confidence propagation | unchanged (min over steps); reproduction inherits step flags ✓ |
| Parity | snapshot byte-identical ✓ |

Tests: [test/solverReproduction.test.ts](../../test/solverReproduction.test.ts) (9) — `planExpectedCost`
(protected/lock-ignoring/unprotected/additive/scaling/p90-selector), `simulatePlanCost` MC ≈ closed-form, and
`searchPlans` uses the model + no-regression depth-1.

## Flags

- **Single-item reproduction is the deterministic re-make term** (a destructive step wipes a secured mod once
  → re-make once). The recombinator's **probabilistic per-attempt** reproduction lives in `ladderCost`
  (unchanged). Both reuse the same insight; neither writes a new RNG model.
- **Chaos/Alt/Essence respect "cannot be changed"** (real 3.28 mechanic) — modeled as lock-respecting,
  contrary to the prompt's parenthetical; only Harvest/fossil/scour ignore locks.
- **Stale bench costs** (RePoE pre-3.28) still distort ranking in the 2–15c band (flagged on bench steps) —
  a data refresh is pending (Eric's parallel work).

## Out of scope / next

The solver's **cost model is now complete** for the modeled methods (protected + unprotected, on a true
expected-cost basis). Remaining coverage: the **anoint producer** (once the notable→3-oil recipe table is
sourced from poedb — Eric's parallel work) and the **synthesis pool** (data gap). Then: wire the **UI per-mod
desired/excluded picker** to emit `TargetSpec` (modId-keyed) — the pinned UI work, where modId-targeting
precision lands. No automation, no Track B.
