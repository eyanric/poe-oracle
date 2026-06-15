# Report — Path Solver, increment 2 (multi-step search)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 324 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

Where the differentiator lands. The spine ranked single methods/recipes; this turns it into a **bounded
branch-and-bound search over method SEQUENCES** across modules. Scoped to **protect-then-proceed** plans
(build one side, protect it, roll the other) — which reuses the protection in `itemState` so there is **no
cross-step failure-reproduction** (deferred to increment 3). The spine's single-method result is the **depth-1
base case ⇒ no regression**. Pure orchestration; clean-room; analysis-only.

## Lead

- **Multi-step search works and beats single-method when it should.** Vaal Regalia, two non-benchable rollable
  mods: the search returns **`essence-force prefix → slam suffix`** (≈53c, depth 2) — cheaper than the best
  single method (`alt → regal` ≈54c). The slam **adds** the suffix to the open slot **without destroying the
  essence-forced prefix** — protection via add-only, exactly the protect-then-proceed structure.
- **Protect-then-proceed is found and costed correctly.** A plan composes `produce one side → lock that side →
  reforge the other`, and because a locked mod can't be changed by a later reforge, **plan cost = Σ per-step
  cost with no cross-step reproduction**. Proven in the synthetic test: with a cheap metamod lock + expensive
  slam, the search returns `produce prefix → lock prefixes → chaos suffix`, and since a returned plan is
  **complete** (all desired present), the post-lock reforge provably did **not** destroy the locked prefix.
- **The search picks the cheapest protection.** Add-only (slam/bench) needs no metamod and beats a 2-Divine
  lock for a cheap single-mod second side (correct — you don't pay 2 div to lock when a slam protects for ~5c);
  the explicit metamod-lock-then-reforge wins when a reforge is the needed second-side production. Both are in
  the search space; b&b + ranking choose correctly.
- **No regression / no padding.** A single benchable mod still solves to the **depth-1 single move** (identical
  to the spine), never a padded sequence. Deterministic-cheap-first holds end-to-end.
- **Bounded + terminating.** Branch-and-bound (prune partials ≥ best complete), beam width, memoization on
  **`(stateKey, remaining)`**, hard depth cap. A **scour** move (reset) can't loop — it returns to the start
  key and is pruned by memoization. **Confidence propagated** (min over steps). **Parity byte-identical.**

## What was built

[src/services/solver.ts](../../src/services/solver.ts) (extends the spine) + `solve_craft` now returns ranked
**plans**:

1. **`searchPlans(target)`** — best-first **branch-and-bound** from `target.start` over moves, **memoized on
   `(stateKey, remaining)`**, bounded by **`SOLVER_DEPTH_CAP=6`** and **`SOLVER_BEAM_WIDTH=64`** (reported).
2. **Moves** (`expand`):
   - **produce-via-method** — the whole remaining set (depth-1 completion) or one affix side, via the spine's
     capacity-gated `methodSpecsFor`; a **reforge is skipped when it would destroy an unlocked present desired
     mod** (so it's only used on a fresh/locked side); successor = the intended-outcome state.
   - **encapsulated recipe** (NNN ladder) when its shape matches.
   - **lock(prefix|suffix)** — a metamod move (cost = the bench "cannot be changed" craft) that protects a
     fully-produced side so a later reforge can't change it; blocks those groups.
   - **scour** — reset to base (enables a fresh roll); memoization makes it non-looping.
3. **Plan cost** = Σ per-step expected cost (each step's internal retry already inside `craftRisk`/`ladderCost`),
   valid **because protection removes cross-step reproduction**. Ranked ascending by risk-adjusted `Σ p90`.
4. **Successor states** reuse `itemState` (`withAffix`/`withMeta`/`withBlockedGroup`); the canonical `stateKey`
   drives memoization.
5. **Output** — ranked plans (ordered moves incl. lock/scour, expected/p90, depth, propagated confidence +
   flags) + the craft-vs-buy verdict vs the **specific-variant** live price (reused from the spine).

## Validation (`npm run validate:solver-multistep`, live + synthetic test)

| Check | Result |
|---|---|
| Protect-then-proceed found | synthetic: `produce prefix → lock prefixes → chaos suffix`, complete ⇒ locks respected ✓ |
| Protection exploited / multi-step beats single | live: `essence → slam` 53c < single `alt→regal` 54c; synthetic: lock-plan < best single ✓ |
| No regression / no padding | single benchable mod → **depth-1** single move (matches spine) ✓ |
| Deterministic-cheap-first | end-to-end (benchable → bench, never a ladder), single- and multi-step ✓ |
| Branch-and-bound prunes | search completes within depth/beam caps (live: ~5 nodes, pruned 5) ✓ |
| Termination on cycles | scour move present; returns to start key ⇒ memoization prevents looping (search terminates) ✓ |
| Memoization | `(stateKey, remaining)` reused (live: 11 memo hits); order-independent key ✓ |
| Confidence propagation | a plan with a flagged step (metamod lock / recipe) carries the flag, min over steps ✓ |
| Abstract rejected | "any prefix" → no plan, specificity message ✓ |
| Parity | snapshot byte-identical ✓ |

Tests: [test/solverMultistep.test.ts](../../test/solverMultistep.test.ts) (7) — explicit-lock plan found +
complete (locks respected), protected plan beats best single (cheap-lock/expensive-slam), termination +
memoization, confidence/flag propagation, no-regression depth-1, abstract reject, search-bounds reported.
Spine tests ([test/solver.test.ts](../../test/solver.test.ts), 7) unchanged ⇒ no regression.

## Flags / deferred to increment 3 (seams left)

- **Protected plans only — a returned plan is a SAFE UPPER BOUND.** General **cross-step failure-reproduction
  for *unprotected* sequences** (a later step destroys an earlier unprotected mod, forcing a full
  expected-cost recursion) is **not** searched — so the solver may **miss cheaper unprotected gambles**. That's
  the intended conservative omission; increment 3 adds it. *Seam:* the per-step compositional cost + the
  `stateKey` memoization are in place.
- **Specialized-method context** (eldritch / influence / catalyst / anoint / veiled / synthesis / strand) is
  still out — they need context (influence type, oils, strands) the search can't infer from a bare mod target.
  Increment 3 adds a **mod → producing-methods + param** index; until then the search uses the **core method
  set + encapsulated recipes** (same as the spine).
- **Stale bench costs** (RePoE pre-3.28 read ~0c) make bench dominate and can prune interesting plans — the
  ranking order is reliable, absolute bench chaos is not (flagged on every bench step).
- **Beam/depth not tuned** — node counts are tiny on the test cases; perf hardening is deferred.

## Out of scope / next

**Increment 3:** unprotected cross-step reproduction + specialized-method context (the remaining coverage).
After it: wire the **UI per-mod desired/excluded picker** to emit `TargetSpec` directly (the pinned UI work),
so the planner is driven from the mockup. No automation, no Track B.
