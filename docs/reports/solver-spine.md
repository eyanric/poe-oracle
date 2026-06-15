# Report — Path Solver, increment 1 (the spine)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 317 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

The differentiator's foundation. Everything since Phase 0 built the method library on a common interface so
this can exist. Increment 1 stands up the **spine** (target → state → applicable actions → goal test →
risk-adjusted cost ranking) and returns a **correct shallow result**: the cheapest risk-adjusted **single
modeled method or encapsulated multi-stage recipe** that reaches a target, with craft-vs-buy. **Multi-step
cross-module sequencing is the NEXT increment** — the spine is built to support it but does not implement it.
Pure orchestration over the existing registry; clean-room; analysis-only.

## Lead

- **Deterministic-cheap-first works.** Ranking by risk-adjusted cost (p90) means the cheap deterministic
  methods naturally win: ring + *maximum Life* → **bench craft** cheapest, ahead of alt-regal (3c) / slam
  (33c) / chaos-spam (2227c). A benchable mod is never "solved" via a recombinator ladder.
- **Producibility gate + goal test.** A weapon-only mod on a ring → **0 supported paths** (excluded, not
  mis-costed). Capacity-gated candidates ensure a path genuinely produces the **full** desired set — fixed a
  real bug where slam/chaos-spam falsely reported "supported" on a 5-mod target while producing one mod.
- **Encapsulated recipe as one ranked candidate.** A shield 3p2s target (5 mods, beyond any single method) →
  the **NNN recombinator ladder** surfaces as one path (~852c, costed via `ladderCost`), correctly the only
  candidate once the single-method false-positives were gated out.
- **Confidence propagation (non-negotiable).** The ladder path carries `confidence: low` + its flags (Stage-A
  table, upper-bound); the solver notes when the cheapest path rests on flagged magnitudes. A high-confidence
  bench path and a flagged ladder are never ranked as equally certain.
- **Craft-vs-buy on the specific variant.** The buy-side prices the **required roll** via mod-filtered trade
  (`estimateRarePriceLive` with the desired mods), not the baseline; verdict compares the cheapest path's p90
  vs the buy range. **Canonical `stateKey`** is implemented now (stable, order-independent) as the
  dedupe/memoization seam for the next increment.

## What was built

[src/services/solver.ts](../../src/services/solver.ts) + the `solve_craft` tool ([tools/craft.ts](../../src/tools/craft.ts)):

1. **`TargetSpec`** — `{ base, ilvl, desired: SpecificMod[], excluded?, start? }`, the shape the UI per-mod
   picker will emit. Specific named mods only (abstract → rejected). `start` defaults to a normal base.
2. **`SolverState`** = `itemState` (reused), with a new **canonical `stateKey`** ([itemState.ts](../../src/services/itemState.ts)).
3. **Candidate enumeration** — `methodSpecsFor` proposes the methods the solver can infer params for, gated by
   **capacity** so each candidate satisfies the full target: essence/chaos-spam/slam (1 mod), alt-regal (≤2,
   1p1s), bench (any), multimod (≥2). Specialized methods needing un-inferable context
   (eldritch/influence/catalyst/anoint/veiled/synthesis/strand) are deferred to the next increment (seam).
4. **`expand`/cost** — each candidate is costed via the existing **`estimateCraftCost`** (→ `craftRisk`
   p50/p90/p95 + brick). The **NNN ladder recipe** is costed via **`ladderCost`** (rung-0 = the rarest
   desired mod's real alt→regal cost; rates via `pSlotSurviveNNN`). One recipe = one candidate.
5. **Goal test** — a method is only a candidate when it produces all desired (capacity gate + the existing
   `unsupported` paths from each module); abstract/excluded handled.
6. **Ranking** — ascending by **risk-adjusted** `p90 ?? mean` (variance-aware, so deterministic beats grindy).
7. **`solve_craft` tool** — ranked paths (method/recipe, exp/p90, P/attempt, risk, confidence+flags) + the
   craft-vs-buy verdict against the specific-variant live price.

## Validation (`npm run validate:solver`, live)

| Check | Result |
|---|---|
| Deterministic-cheap-first | ring + maximum Life → **bench** cheapest (vs alt 3c / slam 33c / chaos 2227c) ✓ |
| Producibility gate | weapon-only mod on a ring → **0 supported**, all excluded (not mis-costed) ✓ |
| Goal test / capacity | single-mod methods not proposed for a 2-mod target; 5-mod shield → no slam/chaos false-positive ✓ |
| Encapsulated recipe | shield 3p2s → **NNN ladder** as one ranked path (~852c) ✓ |
| Craft-vs-buy | cheapest path p90 vs live finished-item price → verdict ✓ |
| Specific-variant buy-side | priced via mod-filtered trade (the required roll), not baseline ✓ |
| Confidence propagation | ladder path carries `low` + flags; cheapest-on-flagged noted ✓ |
| Canonical key | present, stable, order-independent (memoization seam) ✓ |
| Abstract rejected | "any prefix" → no path, specificity message ✓ |
| Parity | snapshot byte-identical ✓ |

Tests: [test/solver.test.ts](../../test/solver.test.ts) (7) — deterministic-cheap-first, producibility gate,
capacity/goal gating, abstract reject, encapsulated recipe + confidence propagation, canonical key
stability/order-independence, start-key on the result.

## Explicitly deferred to the next increment (NOT built — seams left)

- **True multi-step cross-module sequence search** (e.g. essence-force prefix → bench suffix →
  annul-protected exalt slam). Increment 1 ranks single methods/recipes only. *Seam:* the canonical `stateKey`
  + the per-candidate compositional cost are in place; the search (expand over `applicableMethods`, memoize on
  `stateKey`) slots on top.
- **Beam search / branch-and-bound pruning, state memoization, cycle/scour-restart generalization** beyond
  what `ladderCost` already does.
- **Specialized-method candidates** (eldritch/influence/catalyst/anoint/veiled/synthesis/strand) — they need
  context (influence type, oils, strands) the solver can't infer from a bare mod target; the multi-step search
  will supply that context.

## Flags

- **Bench costs read low-confidence** (RePoE export amounts are pre-3.28) — bench paths show a low confidence;
  the ranking order is reliable, the absolute bench chaos is not.
- **The NNN ladder recipe is an upper bound** with a flagged Stage-A table — surfaced as `low` confidence.
- **Specific-variant buy-side** depends on live trade + pseudo-mod coverage; thin/loose filters → low-confidence
  range (flagged), and the verdict confidence is the min of path and buy-side confidence.

## Out of scope / next

The **very next increment is multi-step search** — where the differentiator fully lands. After it: wire the
**UI per-mod desired/excluded picker** to emit `TargetSpec` directly (the pinned UI work), so the planner is
driven from the mockup, not hand-built specs. No automation, no Track B.
