# Report — Path Solver, increment 3a (producer index + specialized methods)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 334 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

The coverage half of the original "increment 3". Until now the search used only the **core** method set
because it couldn't infer the *context* a specialized method needs from a bare mod target. This builds the
**`mod → producing-methods + params` index** and wires in the **data-complete** specialized producers —
**influence, eldritch, veiled** — whose producibility is derivable from tags/domains we already consume.
Anoint, synthesis, catalyst/strand, and unprotected reproduction are explicitly deferred (seams left). This is
what the whole method library was built to feed. Clean-room; analysis-only.

## Lead

- **The producer index inverts each module's eligibility.** [src/services/modProducer.ts](../../src/services/modProducer.ts):
  `classifyMod(mod, base, ilvl, mods)` returns the producing **classes + method specs** for a specific named
  mod — **influence** (compound `{slot}_{codename}` spawn tags → the matching Conqueror/Shaper/Elder exalt;
  **all** matching influences proposed so the search picks the cheapest), **eldritch** (an eldritch-exclusive
  implicit), **veiled** (an unveiled-domain mod → Veiled Chaos/Exalt), else **core**.
- **Specialized targets now solve** (verified end-to-end in the synthetic test, no group conflation): an
  influence-only mod → an **influence exalt**; an eldritch-exclusive implicit → the **eldritch currency** path
  (with the value-tier flag riding along); a veiled mod → an **unveil**. Live: a Warlord all-res suffix →
  `add-influence (warlord)`; a veiled Area-Damage+AoE prefix → `Veiled Chaos Orb`.
- **Specialized producers compose with protection.** Live: `bench craft → add-influence (warlord)` (depth-2) —
  a specialized producer threaded into the multi-step search.
- **Eligibility is mandatory; no false positives.** A plain explicit → **zero** specialized candidates
  (`{core}`). Eldritch is classified **only when exclusive** (in the eldritch pool, **not** a plain explicit
  and **not** influence) — so `AllResistances`/`MovementVelocity` (which are also normal affixes) are *not*
  mis-tagged eldritch (an eldritch implicit is a different slot than the explicit affix).
- **`eldritch ⊥ influence` enforced** at the plan level: a target mixing an influence mod and an eldritch
  mod is rejected (they can't coexist on one item). **Confidence propagated** (min over steps). **Parity
  byte-identical.**

## What was built

- **`modProducer.ts`** — `classifyMod` / `modProducers` (cached per `(base, ilvl, slot, mod)`), inverting
  `influence.ts` / `eldritch.ts` / `veiled.ts` pools + eligibility. Returns **all** applicable routes (a mod
  rollable by several influences, or both veiled and influence, yields every producer; the search ranks by
  cost). Eldritch is gated to **exclusive** implicits via `modWeightIndex` (a group that also rolls as a plain
  affix is not eldritch-classified).
- **Solver wiring** ([solver.ts](../../src/services/solver.ts)) — `methodSpecsFor` appends the specialized
  producers for single-mod subs, so the multi-step search composes them with protection; `searchPlans` adds
  the `eldritch ⊥ influence` mixed-class guard. Costing/confidence/flags reuse `estimateCraftCost` per module
  (no new mechanics).

## Validation (`npm run validate:solver-producers` live + `test/modProducer.test.ts`)

| Check | Result |
|---|---|
| Influence target solves | influence-only mod → influence exalt is the plan (synthetic); live Warlord all-res → `add-influence (warlord)` ✓ |
| Eldritch target solves | eldritch-exclusive implicit → eldritch currency path + value-tier flag (synthetic) ✓ |
| Veiled target solves | veiled mod → unveil (synthetic); live veiled AoE → `Veiled Chaos Orb` ✓ |
| Specialized + protection composes | `… → add-influence` depth-2 plan found ✓ |
| Exclusion enforced | influence + eldritch target → rejected, "eldritch ⊥ influence" (synthetic) ✓ |
| No false positives | plain explicit → `{core}`, zero specialized candidates ✓ |
| Anoint / synthesis deferred | anoint out (no recipe table); synthesis-implicit unclassifiable (pool gap) → `core` ⇒ not guessed ✓ |
| No regression | spine (7) + multi-step (7) tests unchanged; benchable still → bench ✓ |
| Confidence propagation | eldritch value-tier flag (`⚠`) rides into the plan; min over steps ✓ |
| Parity | snapshot byte-identical ✓ |

Tests: [test/modProducer.test.ts](../../test/modProducer.test.ts) (10) — `classifyMod` for influence-only /
eldritch-exclusive / veiled-exclusive / plain (synthetic, no group conflation), and the search solving each
specialized target, composing with protection, enforcing the exclusion, and never specializing a plain target.

## Flags / deferred to 3b (seams left)

- **Group-name conflation (live only):** a target by *group* can match the eldritch implicit *and* a same-group
  explicit/essence — the search then (correctly) prefers the cheaper explicit route, so a live "cheapest uses
  eldritch" isn't guaranteed. The producer is still correctly proposed; the **synthetic test proves the
  exclusive-implicit end-to-end**. Targeting by `modId` removes the ambiguity.
- **Anoint** producer — needs the notable→3-oil **recipe table** (curated seed only). *Seam:* anoint never
  matches an item-mod target (it's a notable enchant); the index leaves it out, documented.
- **Synthesis** producer — the synthesis implicit **pool is not in repoe-fork** → a synthesis-implicit target
  is unclassifiable, so it yields **no specialized candidate** (not guessed) rather than a fabricated route.
- **Catalyst** (scales an existing mod's magnitude — a refinement) and **strand** (a state-conditioning boost)
  are **not producers** — out of this index by design.
- **Unprotected cross-step failure-reproduction** — still **3b**. Protected plans remain a safe upper bound.
- **Awakener's** (arity-2) influence route isn't proposed as a producer move (the search doesn't synthesize two
  input items); `add-influence` covers the single-item influence path.
- **Stale bench costs** (RePoE pre-3.28) still distort ranking in the 2–15c band (flagged on bench steps).

## Out of scope / next

**3b:** the anoint producer (once the recipe table is sourced from poedb) + the **unprotected cross-step
reproduction** cost recursion. Then wire the **UI per-mod desired/excluded picker** to emit `TargetSpec`
directly (the pinned UI work). No automation, no Track B.
