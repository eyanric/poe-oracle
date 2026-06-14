# Report — crafting method-module interface (v2, multi-arity)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, output-identical refactor, gates green (188 tests).

Defines the common interface every crafting method implements so the risk engine (today) and the path
solver (later) compose methods uniformly — and proves it expresses all three method shapes. **Refactor
with zero behaviour change:** no new methods, no solver, no Track B, no automation. Clean-room; layering held.

## Lead — the item-state model + the contract carries all three shapes

### Item state ([services/itemState.ts](../../src/services/itemState.ts))
The canonical mid-craft item every method transforms — **immutable** (transforms return new states) so a
search explores side-effect-free. Models comprehensively: base/class/ilvl/rarity; affixes with
tier/value/crafted/fractured; slot **caps + occupancy**; **blocked groups** (block-to-raise-augment-odds,
first-class); tags; active **meta-mods** (multimod, prefixes/suffixes-cannot-be-changed,
cannot-roll-attack/caster); influence/fractured/quality/catalyst/corrupted; and **depleting per-item
resources** — `memoryStrands` (3.28) modelled as *shape*: a per-item attribute that conditions a craft's
outcome distribution and is consumed per use (`consumeResource`). Queries (`openSlots` returns 0 when a
protective meta locks the slot; `canRollGroup` respects caps/locks/blocked/present) + transforms
(`withAffix/withBlockedGroup/withMeta`). 6 unit tests.

### The multi-arity contract ([services/craftModule.ts](../../src/services/craftModule.ts))
`CraftModule` is defined over an **InputSet of arity 1 or 2** returning an **OutcomeDistribution over
ItemState**, with a resource-conditioning hook — so the solver can compose:
1. **single-item transform** (arity 1) — essence/fossil/bench/slam/…
2. **two-item combine** (arity 2) — recombinators; `outcomes([a,b])`; **mod-loss is the brick**.
3. **resource-conditioned** — `resourceConditioning.reweight(dist, level)` + depletes (memory strands).

Each module exposes **pure/queryable** `applicable` / `outcomes` / `cost` / `toRiskSteps` (+ an
`evaluate` bridge to today's risk engine). `cost` carries a **manual-price hook** for off-market service
prices (Harvest/beast/Aisling, supplied later) + low-confidence flags. `toRiskSteps` maps to
`craftRisk` fixed/keep-trying/**slam** including **recoverable-vs-brick** (slam under a protective
meta-mod = recoverable — that's how the same slam reads high-brick unprotected and safe protected).

**Contract conformance proven** ([test/craftModuleContract.test.ts](../../test/craftModuleContract.test.ts)):
all 7 registered methods are arity-1 modules exposing the contract; an illustrative **arity-2
recombinator** returns a distribution with a mod-loss **brick** outcome; a **memory-strand**
resource-conditioning re-weights a distribution and depletes. The two non-arity-1 examples are stubs
(no new methods ship) — they exist to prove the contract carries those shapes for the roadmap.

## Refactor (Phase 3) — composes through the interface, output-identical
`CRAFT_MODULES` registry (one module per method) + `evaluateMethod(state, data, params)` replace the
bespoke `switch`. `calc_craft_cost` builds an `ItemState` from the spec and dispatches through
`evaluateMethod` — no per-method code in the cost layer. The proven probability/cost/risk math is
**untouched**; modules wrap it. `expectedAttempts(ctx, …)` stays as a thin back-compat adapter (existing
callers/tests unchanged).

## Regression bar — met
- **Parity snapshot** ([test/methodParity.test.ts](../../test/methodParity.test.ts)): snapshots
  `calc_craft_cost` across the **9-case method matrix** (essence, alt-regal 1- & 2-mod, chaos-spam, bench,
  multimod, slam protected/unprotected, with-buyside) — written PRE-refactor, **byte-identical** after.
- Full suite **188 tests** green (+19: parity 9, itemState 6, contract 3, +1); typecheck + lint (layering)
  green; build green; **`validate:craft` live green** (essence deterministic, alt-regal grind, hedged
  verdict — all matching pre-refactor).

## Docs
[docs/method-interface.md](../method-interface.md): the item-state model (incl. depleting resources), the
multi-arity module contract, and how a new method (single / two-item / resource-conditioned) and the
future solver plug in.

## Out of scope / next
No new methods. Roadmap order from here: prove the interface on **Harvest** (single-item), then
**recombinators** (two-item) and **memory strands** (resource-conditioned) as shape stress-tests, then
the rest of Tier 1, then the **solver** (consumes `applicable`/`outcomes`/`cost`/`toRiskSteps`). No Track
B; no automation.
