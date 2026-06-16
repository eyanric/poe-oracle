# Report — synthesis implicit pool (generation + producer)

**Date:** 2026-06-16 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 387 tests ✓ · build ✓ · **parity byte-identical**). Pushed to `origin/main`.

Closes the last "not in any export" gap: sources the per-item-class synthesised-implicit pool from poewiki
Cargo, replaces the caller-supplied `poolSize` guess with the real one, and wires the synthesis producer.
One concern (synthesis pool + producer). Clean-room; analysis-only.

## Step 1 — diagnosis: the pool exists; the weights do not (verified)

- **The pool is sourced from poewiki Cargo `synthesis_mods`** (browser-UA, 200 on first request — reuses the
  proven `gen-anoints` path). Schema: `item_class_ids` → `mod_ids` (the `SynthesisImplicit*` gear mods),
  one row per stat. 2228 rows → **24 gear item classes**, ~190–313 distinct implicit options each (Amulet
  248, Ring 236, Staff 313). The repoe-fork `synthesis_*` generation-types are MAP/Memory mods, and its
  real `SynthesisImplicit*` mods carry empty `spawn_weights` — so repoe-fork alone is unusable here.
- **Synthesis implicits have NO spawn weights — anywhere.** Verified on both sources: repoe-fork
  `spawn_weights: []` for every `SynthesisImplicit*`, and poewiki `mod_spawn_weights` returns **no rows**
  for them (while a normal explicit like `AddedColdDamage1` returns amulet/gloves/ring = 500). They are
  **not weight-rolled**. So per Step 1's branch — *"if the weight data isn't present, report precisely and
  fall back to the honest uniform rather than inventing weights"* — the reroll is `P = 1/poolSize`, uniform,
  but now over the **real per-class pool size** (not a caller guess). **No weights invented.**

## What was built

- **[scripts/gen-synthesis.mjs](../../scripts/gen-synthesis.mjs)** — `npm run gen:synthesis` (browser UA +
  delay, `--cache`, idempotent, fail-loud on 403/429). Groups `synthesis_mods` by item class → distinct
  outcome count (`options`, the reroll pool size) + distinct `SynthesisImplicit*` mod ids (`mods`,
  membership). Asserts (24 classes; Amulet ≥ 100; a known Life implicit on Ring; all ids `Synthesis*`)
  before writing. The per-league refresh.
- **[src/data/synthesisImplicits.ts](../../src/data/synthesisImplicits.ts)** — generated: `SYNTHESIS_POOL`
  (per class `{ options, mods }`), `synthesisPoolSize`, `isSynthesisImplicit`. Provenance header.
- **Reroll grounded** ([synthesis.ts](../../src/services/synthesis.ts)): `synthesis-reroll` derives
  `poolSize` from the data for the base's item class when the desired modId is a real synthesis implicit
  (a caller `poolSize` still wins as override). `P = 1/poolSize`, uniform, flagged "no spawn weights exist".
  A non-pool modId without a caller `poolSize` is **unsupported** (not invented).
- **Producer** ([modProducer.ts](../../src/services/modProducer.ts)): a `synthImplicit` target whose modId
  is in the pool for the base's class → `{ kind: 'synthesis-reroll', poolSize }`. Non-pool, or a class with
  no synthesis implicits ⇒ **no candidate** (no false positive). Disjoint from the affix producers.
- **Solver** ([solver.ts](../../src/services/solver.ts) + [itemState.ts](../../src/services/itemState.ts)):
  synthesis implicits modelled on an **implicit slot** (`synthImplicits`, `withSynthImplicit`) — like the
  anoint enchant slot, no affix-capacity collision, folded into `stateKey`. `modPresent`/`applyProduce`/
  `methodSpecsFor`/`expand` handle the slot; **eldritch ⊥ synthesis** is enforced in `searchPlans`
  (eldritch currency deletes synthesis implicits).

## Verify (`npm run validate:synthesis-pool`, live)

| Check | Result |
| --- | --- |
| Browser-UA Cargo | 200 on first request (fail-loud on 403/429) |
| Pool sane | 24 gear classes, ~190–313 options each (Amulet 248, Ring 236) |
| Weighted reroll | **weights absent (verified)** → honest uniform `P = 1/poolSize` over the real pool (Ring 1/236 = 0.42%) — not a caller guess |
| Producer solves | pooled implicit → `synthesis-reroll` producer with real `poolSize`; non-pool → no candidate |
| Exclusion | `eldritch ⊥ synthesis` enforced (synth + eldritch target on Gloves → 0 plans, correct verdict) |
| Vivid Vulture pricing | manual hook — beast not in the feed → the solver leaves the route unranked (flagged, not invented) |
| No regression / parity | additive data + data-gated probability; 387 tests (+8); **parity snapshot byte-identical** |

## Flags / next

- **The browser-UA win is now load-bearing twice** (anoints, synthesis) — poewiki/poedb Cargo is a reliable
  Code-fetchable source going forward.
- **Synthesis implicit weighting genuinely does not exist** — the uniform is correct, not a placeholder. If a
  future patch adds weights, the generator picks them up.
- **Standing synthesis flags unchanged:** the synthesise count distribution (75/19/6, datamined Harvest
  league) and **Vivid Vulture pricing** (beast, not in the feed → manual hook) remain flagged. A full ranked
  synthesis plan needs a supplied Vulture price.
- **This closes the last data gap.** Remaining: ring/blight-map anoints (cheap same-generator add, low
  priority) and the **UI per-mod picker → `resolveTargets` → modId/`minTier`/anoint/synthesis `TargetSpec`**
  (the pinned UI work).
- No automation, no Track B.
