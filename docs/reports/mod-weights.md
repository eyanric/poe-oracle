# Report — specific-mod weight resolution (real weights, real targets)

**Date:** 2026-06-14 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 232 tests ✓ · build ✓ · parity snapshot byte-identical).

The precision the tool exists for: cost **specific named mods at specific tiers on a specific base** using
their **REAL spawn weights** — never "any T1", never a flat representative cost. Derived from repoe-fork
`mods.json` (already consumed; this DERIVES an index, it does not scrape). Clean-room, analysis-only.

## Lead — what changed

- **Per-base resolved-weight index built and spot-checked** ([src/services/modWeightIndex.ts](../../src/services/modWeightIndex.ts)):
  `base → { eligible prefixes/suffixes with resolved weight, group, affix, ilvl, tier }`, cached per `(base, ilvl)`.
  Spot-check on **Titanium Spirit Shield @ ilvl 84**: prefix pool **Σ77481 / 105 mods**, suffix pool **Σ80875 / 97 mods**;
  excludes essence-only and weight-0 (off-base) mods; tiers derived as dense rank by `required_level` (T1 = highest).
- **No flat/representative/averaged fallback survives any currency-spend path.** Audit confirmed every spend
  path already rides on real per-mod `slotShare` weight and **flags (unsupported) rather than substituting**
  when a mod can't roll. The one offender — the ladder script's **~1c "any T1" Vaal-Regalia rung-0 stand-in**
  — is **removed**; rung-0 is now the real per-target alt→regal cost on the real shield.
- **Specific-named-mod contract enforced** at the single `calc_craft_cost` entry point: abstract targets
  ("any T1 prefix") are **rejected**, not priced. Specificity is the product.
- **Double-block shield re-run with REAL Spirit Shield mods** (named groups, real weights). The defining
  finding: **both block mods are PREFIXES** on a Spirit Shield, and the **attack-block** prefix is genuinely
  rarer (w500 vs w1000) — so the real rarest rung-0 target costs **15c**, not the flat ~1c placeholder.
  ⚠ **confirm these are the 5 you want** (target set below).

## Part 1 — the per-base resolved-weight index

`P(roll specific mod) = resolvedWeight(mod, base) / Σ resolvedWeight(eligible same-affix mods)`. Weights come
from `effectiveWeight` (tag-priority resolution) — the index does **not** re-derive weights, it caches a
base-keyed, tier-annotated VIEW of the same data the working methods already use (so zero parity risk).

API:
- `buildBaseModIndex(baseName, itemClass, baseTags, ilvl, mods) → BaseModIndex` — excludes `is_essence_only`,
  resolved-weight ≤ 0, and `required_level > ilvl`; assigns dense tiers within each group.
- `resolveBaseModIndex(base, mods, ilvl)` — cached by `${base.name}|${ilvl}`.
- `modRollProbability(index, { affix, modId?, group? })` — `modId` → that exact tier's weight/pool;
  `group` → summed family weight/pool; **abstract → 0**.
- `isSpecificTarget({ modId?, group? })` — true only when named by modId or group.

Tests: [test/modWeightIndex.test.ts](../../test/modWeightIndex.test.ts) (8) — eligibility filtering, pool
totals, tier derivation, ilvl gating, and the three `modRollProbability` cases.

**Flag:** these are **base spawn weights** (3.28). Fossil / essence / influence / catalyst deltas are layered
by their own methods — noted here, **not** rebuilt in the index.

## Part 2 — audit: real weights everywhere, flat fallbacks removed

Every currency-spend path resolves the **real** per-mod weight and **flags, never substitutes**, on failure:

| Path | Real-weight resolution | Resolution-failure behavior |
|---|---|---|
| alt/regal/transmute (`pOne`) | `pSlot(slot) × slotShare(pool, matcher)` ([craftMethods.ts:178](../../src/services/craftMethods.ts#L178)) | any desired `slotShare ≤ 0` ⇒ `unsupported(...)` ([:180](../../src/services/craftMethods.ts#L180)) |
| two-affix (alt-regal 1p1s) | `pTwoAffix × slotShare(pre) × slotShare(suf)` ([:200](../../src/services/craftMethods.ts#L200)) | same `≤ 0` guard upstream |
| fossil | `share = slotShare(pool, matcher)` ([:245](../../src/services/craftMethods.ts#L245)) | `share ≤ 0` ⇒ `unsupported` ([:246](../../src/services/craftMethods.ts#L246)) |
| slam (open slot) | `pSuccess = slotShare(pool, matcher)` ([:322](../../src/services/craftMethods.ts#L322)) | `≤ 0` ⇒ `unsupported` ([:323](../../src/services/craftMethods.ts#L323)) |

`matcher` ([:113](../../src/services/craftMethods.ts#L113)) matches **by `modId` (exact tier) or `group` (family)** —
an abstract target (`!modId && !group`) returns `false` ⇒ `slotShare = 0` ⇒ unsupported. So there is no
"any T1" cost path at the method layer either.

**The only flat fallback in the codebase** was the ladder *script's* representative rung-0 (~1c alt→regal on
a Vaal Regalia life roll). **Removed** — rung-0 now calls `estimateCraftCostLive` for each real target on the
real shield, so the per-attempt probability is the mod's real resolved weight. Unresolvable named groups in
the script **throw** (flag-don't-substitute), consistent with the model.

## Part 3 — specific-named-mod input contract

[src/services/craftCost.ts:207](../../src/services/craftCost.ts#L207) — right after base lookup,
`estimateCraftCost` rejects any `desired` entry with neither `group` nor `modId`:

> *abstract target not supported — name the specific mod (group or modId), not "any prefix/tier". Specificity is the product.*

(Empty `desired` is still allowed — essence/bench/multimod targets carry their own resolution.) Test:
[test/craftCost.test.ts](../../test/craftCost.test.ts) — "rejects an abstract target (specific named mods only)".

## Part 4 — double-block shield, REAL mods vs the placeholder

**Base:** Titanium Spirit Shield (`int_armour, focus, shield, armour, default`), ilvl 84.
**Target set — instantiated from real named groups (not regex), resolved against the index:**

| Slot · Tier | Group (role) | Real weight | % of affix pool | Mod text |
|---|---|---|---|---|
| prefix T1 | `SpellBlockPercentage` (**spell block**) | **1000** | 1.29% | (14-15)% Chance to Block Spell Damage |
| prefix T1 | `IncreasedShieldBlockPercentage` (**attack block**) | **500** | 0.65% | (70-75)% increased Chance to Block |
| prefix T1 | `BaseLocalDefences` (+max ES) | 1000 | 1.29% | +(77-90) to maximum Energy Shield |
| suffix T1 | `AllResistances` (+all elem res) | 1000 | 1.24% | +(15-16)% to all Elemental Resistances |
| suffix T1 | `ColdResistance` (+cold res) | 1000 | 1.24% | +(46-48)% to Cold Resistance |

⚠ **confirm these are the 5 Eric wants.** Two judgment calls surfaced by using real data:
1. **Both block mods are prefixes** on this base — a "double-block" shield spends 2 of its 3 prefixes on
   block (spell + attack), leaving one prefix for ES. The earlier placeholder treated block as suffixes.
2. **The two suffixes are filler** (resistances) — swap freely; they don't change the block thesis.

**Per-target real rung-0 (alt→regal) cost** — real resolved weight ⇒ real rollability:

| Group | P / alt | rung-0 cost |
|---|---|---|
| SpellBlockPercentage | 0.96% | 7c |
| **IncreasedShieldBlockPercentage** | **0.48%** | **15c** ← rarest (half weight) |
| BaseLocalDefences | 0.96% | 7c |
| AllResistances | 0.93% | 8c |
| ColdResistance | 0.93% | 8c |

Donors are made for the **rarest** desired (conservative), so rung-0 unit = **15c** (real) — vs the removed
**~1c flat Vaal-Regalia stand-in**, a **~15× understatement** of the donor floor.

**How the total + donor count shift vs the placeholder run** (Stage-A rates unchanged → donor counts unchanged;
the rung-0 unit cost is what moved):

| Scenario | Placeholder rung-0 (~1c) total | REAL rung-0 (15c) total | Δ |
|---|---|---|---|
| default Stage-A (model) | 855c (1.50 div) | **968c (1.70 div)** | +113c |
| guide-calibrated (conservative Stage-A) | 8727c (15.32 div) | **9897c (17.38 div)** | +1170c |

Expected single-mod donors consumed: **~16** (default) / **~165** (conservative) — unchanged; the donor
*count* is driven by the rates (Part A), the donor *unit cost* by the real weights (Part 4). Both now real.

## Caveats (carried)

- **UPPER BOUND:** the ladder assumes a failed recombine loses ALL inputs; failed bases often still carry
  desired mods and can be re-padded/re-smashed → true cost is lower. Partial-salvage is a future refinement.
- **Stage-A count distribution is the flagged, dominant lever** (separate open issue, unchanged here) — it
  needs real GGG data; recomb/pad costs in the script are representative parameters.
- Recombinators are **league-gated off in Mirage**; the run treats rates as model-validation, not a live
  craft recommendation.
- Index weights are **base spawn weights**; fossil/essence/influence/catalyst deltas layer via their own methods.
