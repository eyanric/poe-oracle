# Crafting method-module interface (v2 — multi-arity)

The contract every crafting method implements so the risk engine (today) and the path solver (later)
compose methods uniformly. This is the foundation the rest of the crafting roadmap sits on.

## 1. Item state — the shared currency

[`services/itemState.ts`](../src/services/itemState.ts). The canonical mid-craft item that every method
reads and produces. Immutable transforms (return new states) so a search explores paths side-effect-free.

```
ItemState {
  base, itemClass, ilvl, rarity
  affixes: Affix[]            // modId, group, slot, tier?, value?, crafted?, fractured?
  caps: { prefix, suffix }    // rare 3/3, magic 1/1, normal 0/0
  blockedGroups: string[]     // block-to-raise-augment-odds (central — modelled)
  tags: string[]
  meta: { multimod?, lockPrefixes?, lockSuffixes?, noAttack?, noCaster? }
  influence[], fractured[], quality, catalyst?, corrupted?
  resources: { memoryStrands?, [k]: number }   // DEPLETING per-item resources
}
```

Key queries/transforms: `openSlots` (0 when the slot is locked by a protective meta-mod), `canRollGroup`
(respects caps, locks, blocked + present groups), `withAffix` / `withBlockedGroup` / `withMeta`, and
`consumeResource` (depletes + clamps). **Depleting resources** — `memoryStrands` (3.28) is modelled as
*shape*: a per-item attribute that conditions a craft's outcome distribution (biases tier, not
desirability) and is consumed per use. Exact rules get pulled when its module is built; the state
already carries the attribute and the conditioning hook exists (below).

## 2. The module contract (multi-arity)

[`services/craftModule.ts`](../src/services/craftModule.ts). Methods do **not** all share `state →
state'`. The contract is defined over an **input set** of arity 1 or 2 returning an **outcome
distribution**, with a resource-conditioning hook — so the solver composes all three shapes:

| Shape | Arity | Example | Brick case |
|---|---|---|---|
| single-item transform | 1 | essence, fossil, bench, slam, eldritch, harvest | unprotected slam/annul |
| two-item combine | 2 | recombinators | mod-loss on combine |
| resource-conditioned | (modifier) | memory strands | — (re-weights another craft) |

```
CraftModule {
  id, title, arity: 1 | 2
  applicable(inputs, ctx, params): { ok, reason?, slots? }      // can it act, where?
  outcomes(inputs, ctx, params): { outcomes: {p, state}[] }     // result-state DISTRIBUTION
  cost(inputs, ctx, params): { steps, lowConfidence, manualPriceHooks? }
  toRiskSteps(inputs, ctx, params): PlanStepBlueprint[]         // → craftRisk fixed/keep-trying/slam
  resourceConditioning?: { resource, consumes, reweight(dist, level) }
  evaluate(inputs, ctx, params): ExpectedAttemptsResult         // bridge to today's risk engine
}
```

- **`applicable` / `outcomes` are pure/queryable** — no real craft executed, so a path search explores
  freely. `outcomes` is the per-single-use distribution the solver iterates.
- **`cost`** carries a **manual-price hook** (`manualPriceHooks`) for off-market service prices
  (Harvest/beast/Aisling) supplied later, plus low-confidence/freshness flags.
- **`toRiskSteps`** maps onto `craftRisk` steps, including **recoverable-vs-brick**: a `slam` under a
  protective meta-mod is `recoverable`, otherwise a brick (this is how the same exalt slam reads
  `high-brick` unprotected and safe protected).
- **`resourceConditioning`** is how a method/resource re-weights *another* craft's outcome distribution
  (memory strands → tier bias) and depletes — the third shape.
- **`evaluate`** is the bridge to the current risk engine: it returns the expected-attempts/consumable
  model `craftCost` prices today. The solver will consume `outcomes`/`cost`/`toRiskSteps` directly.

Contract-conformance is tested in [`test/craftModuleContract.test.ts`](../test/craftModuleContract.test.ts):
a registered single-item module, an illustrative arity-2 recombinator (with a mod-loss brick outcome),
and a memory-strand resource-conditioning — proving the contract carries all three shapes.

## 3. Registry + how `calc_craft_cost` composes

[`craftMethods.ts`](../src/services/craftMethods.ts) holds `CRAFT_MODULES` (one module per method:
essence, alt-regal, chaos-spam, fossil, bench, multimod, slam — all arity 1 today) and
`evaluateMethod(state, data, params)`. `calc_craft_cost` builds an `ItemState` from the spec and
dispatches through `evaluateMethod` — no bespoke per-method `switch`. `expectedAttempts(ctx, …)` remains
as a thin back-compat adapter that builds the state and dispatches through the same registry.

## 4. Adding a method (and the solver)

- **Single-item** (next: Harvest): add a module whose `outcomes` transforms one `ItemState`; register it;
  `toRiskSteps` maps to fixed/keep-trying/slam; `cost` declares any off-market `manualPriceHooks`.
- **Two-item** (recombinators): `arity: 2`, `outcomes([a, b], …)` returns the combine distribution incl.
  the mod-loss brick.
- **Resource-conditioned** (memory strands): set `resourceConditioning` and have `outcomes` read/deplete
  `state.resources`.
- **The solver** will explore paths by calling `applicable` → `outcomes` over `ItemState`s (side-effect
  free), pricing candidate paths via `cost`/`toRiskSteps` + the risk engine. Everything it needs is on
  this contract.

## Regression note
This interface landed as an **output-identical refactor** — `test/methodParity.test.ts` snapshots
`calc_craft_cost` across the whole method matrix; the refactor left every snapshot byte-identical.
