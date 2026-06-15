# Report — Memory Strands (Tier-2, resource-conditioned)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 310 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

The **depleting-resource arity** the v2 interface declared (`itemState.resources.memoryStrands` +
`CraftModule.resourceConditioning`) but **nothing had exercised yet** — now used for real. **All three
interface shapes are proven:** single-item (arity-1), two-item combine (recombine/Awakener's, arity-2), and
**resource-conditioned** (this). Hinekora's Lock is **not** modelled (deprioritized). Clean-room; analysis-only.

## Lead

- **Resource-conditioned roll, proven end-to-end.** A reforge/add currency on a strand item biases the roll
  toward higher tiers and depletes strands. On Vaal Regalia targeting T1 Life: **0 strands P 20.3% → 100
  strands P 33.8%** (×2.0 boost). At **0 strands it reverts exactly to the normal weight-index roll.**
- **Depletion + sequence EV** modelled across a multi-craft sequence (not one roll): from 100 strands the
  expected reforges ≈ **3.3** (10 boosted crafts at 10/craft) vs **4.9** un-stranded; the boost diminishes as
  strands deplete. The outcome state decrements strands (100 → 90), and the module populates the formal
  `resourceConditioning` hook (`resource: memoryStrands, consumes: 10, reweight`).
- **Orb of Remembrance** (replenish, normal item) and **Orb of Unravelling** (consume-all tier-upgrade
  gamble) modelled. Unravelling is **genuine RNG post-3.26.0d** — it can consume every strand and upgrade
  nothing: P(whiff) ≈ 74% / 22% / 5% at 10 / 50 / 100 strands (flagged odds).
- **⚠ The three magnitudes are flagged, caller-overridable constants** (not in repoe-fork): tier-boost/strand,
  strands/craft, Unravelling upgrade-odds. **The structure is the product; the numbers are pluggable.**
- All currencies priced live (Remembrance 165c, Unravelling 100c). **Parity byte-identical.**

## What was modelled

[src/services/memoryStrands.ts](../../src/services/memoryStrands.ts):

1. **`strand-craft`** (arity-1, **resource-conditioned**) — conditions the weight-index roll on
   `state.resources.memoryStrands`: `conditionedShare = (share·boost)/(1−share+share·boost)` where
   `boost = 1 + STRAND_BOOST_PER_STRAND·min(strands,100)` (exact pool-reweight of the desired mod's weight;
   boost = 1 at 0 strands ⇒ reverts). Depletes `STRANDS_PER_CRAFT` per craft (clamp 0) on the outcome state.
   `strandSequenceEV` models the depleting sequence (boosted crafts then a base-rate geometric tail). Populates
   `module.resourceConditioning` with a working `reweight(dist, level)`.
2. **`remembrance`** (Orb of Remembrance) — replenish strands on a **normal** item (rejects non-normal).
3. **`unravelling`** (Orb of Unravelling) — consume **all** strands to gamble tier upgrades:
   `E≈UNRAVEL_UPGRADE_EV_PER_STRAND·strands`, `P(whiff)=(1−UNRAVEL_UPGRADE_CHANCE_PER_STRAND)^strands`
   (the no-op outcome is explicit). Enforces: ignores meta-locks; no Elevated on influenced; needs strands > 0.

Constraint honoured: only reforge/add currencies interact — **fossils / bench / metacrafts pass through**
untouched (they're separate modules that don't read strands). Wired through `CRAFT_MODULES` +
`CraftMethod`/`MethodSpec` + `resolveMethod` + the `calc_craft_cost` tool (`strand-craft` / `remembrance` /
`unravelling` + `memoryStrands` / `rarity` / `strandCurrency` inputs; `CraftSpec` gained `memoryStrands` +
`rarity`).

## Validation (`npm run validate:memory-strands`, live)

| Check | Result |
|---|---|
| Strand-boosted roll vs un-stranded | T1 Life **20.3% → 33.8%** at 100 strands (×2.0) ✓ |
| Revert at 0 | 0-strand P == base weight-index roll ✓ |
| Depletion | 100 → 90 strands on the outcome state (10/craft, clamp 0) ✓ |
| Sequence EV | 100 strands ≈ 3.3 vs 4.9 un-stranded; 0 strands == 4.9 (reverts) ✓ |
| Remembrance | normal item ✓; rare item rejected ✓ |
| Unravelling — whiff | reachable (P(whiff) 74% / 22% / 5% at 10 / 50 / 100) ✓ |
| Unravelling — meta-locks / Elevated | ignores locks; no Elevated (flagged in notes) ✓ |
| Resource-conditioned shape | `resourceConditioning` hook present + reweight tested ✓ |
| Parity | 9-case snapshot byte-identical ✓ |

Tests: [test/memoryStrands.test.ts](../../test/memoryStrands.test.ts) (9) — `strandBoost`/`conditionedShare`/
`strandSequenceEV` (incl. 0-strand = 1/share revert), strand-craft boost + revert + depletion +
`resourceConditioning.reweight` + abstract reject, remembrance normal-only, unravelling strands-required.

## Flags (for Eric to verify in-game)

- **Three magnitudes flagged, caller-overridable** (defaults: boost 0.01/strand ⇒ ×2.0 at 100; 10 strands/craft;
  Unravelling 0.03 upgrade-chance + 0.02 EV per strand). Source community datamines or confirm in-game.
- **Unravelling is genuine RNG post-3.26.0d** — modelled as a gamble with an explicit whiff, NOT the old
  infinite tier-up loop (any guide describing a deterministic loop predates the nerf).
- **Hinekora's Lock NOT modelled** (deprioritized — multi-divine price won't drive a craft-vs-buy verdict).

## Out of scope / next — a fork for Eric to decide (not started)

This **closes Tier 2** (Hinekora's skipped). Methods on the interface now: currency/essence/fossil/bench/meta/
harvest/recombine(arity-2)/eldritch/influence(+Awakener's arity-2)/catalyst/anoint/veiled/synthesis/
**memory-strands (resource-conditioned)** — **all three arities exercised.** The next decision is a genuine
fork — **flagging it, not starting either:**

- **(A) More Tier-3 coverage** — corruption / beastcrafting / resonator multi-fossil combos / lab enchants +
  Tempering. Breadth; each is another arity-1 or deterministic module.
- **(B) Pivot to the PATH SOLVER** — the sequence-search differentiator. We now have enough methods on the
  common interface (incl. the resource-conditioned shape) that a multi-step solver becomes the high-value
  build. This is the product's differentiator per the roadmap.

No solver, no Track B, no automation started — awaiting your call on the fork.
