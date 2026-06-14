# Report — Influence crafting (Tier-1 #2)

**Date:** 2026-06-14 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 265 tests ✓ · build ✓ · parity snapshot byte-identical).

Second Tier-1 module. **Reuses all three prior pieces**: the resolved-weight machinery (`effectiveWeight`)
on the influence-gated pools, the **arity-2 input channel** (`evaluateInputs([a,b])`) for Awakener's Orb, and
the shared `isInfluenced` eligibility primitive (influence ⊥ eldritch) the eldritch module placed. Clean-room;
analysis/information only; manual-invoke. Confirmed PoE 1, current 3.28.

## Lead

- **Add-influence cost via the weight machinery.** `P(named influenced mod) = weight / influenced-pool` over
  the pool gated by the compound `{slot}_{codename}` tag. On **Vaal Regalia @86**: a Hunter *+% maximum Life*
  mod is P=**22.2%** of the Hunter pool → ~4.5 Hunter's Exalts → **24673c (43.3 div)** (Hunter's Exalt is
  5483c — the currency, not the odds, is the cost).
- **Awakener's Orb through the arity-2 channel.** Two influenced inputs (different influence, same class) →
  output with both influences, carrying **one influenced mod from each** (random among that input's influenced
  mods): `P(carry both) = 1/nA × 1/nB`. **Single-influenced-mod donors ⇒ guaranteed transfer (P=100%)** — 1
  Awakener's Orb (4.3 div) + the two donor items; a 2-influenced donor halves it to 50%.
- **Orb of Dominance (ex-Maven's) elevate + collateral.** `P(elevate intended) = 1/nInfluenced` (~50% with 2)
  and the **collateral is modelled**: one *other* influenced mod is removed at random each use (certain loss).
  Validated: 50% on a 2-influenced helmet → ~8224c (14.4 div), p90 2× mean.
- **Eligibility reuse (influence ⊥ eldritch).** Add-influence **rejects an already-influenced item** (Conqueror/
  Shaper/Elder exalts need a no-influence rare); Orb of Dominance **rejects < 2 influenced mods** and non-armour
  bases — all via the shared `isInfluenced` / affix-count checks.
- **Currencies priced live** (all six exalts + Awakener's + Orb of Dominance). **Parity snapshot byte-identical.**

## Data grounding (repoe-fork mods.json)

Influenced mods are ordinary prefix/suffix mods gated by a **compound `{slotTag}_{codename}` spawn tag** the
game adds on influence: `gloves_shaper`, `helmet_eyrie`, `body_armour_basilisk`, … The compound tag sits first
in `spawn_weights` (then `default: 0`), so the gated pool resolves by **augmenting the base tags with
`{tag}_{codename}`** and reusing `effectiveWeight`. Influence-only isolation: keep mods with **base weight 0
but augmented weight > 0** (so base-rollable mods are excluded).

**Conqueror codenames** (confirmed in the data): `crusader` = Crusader, **`eyrie` = Redeemer**, **`basilisk` =
Hunter**, **`adjudicator` = Warlord** (+ `shaper` / `elder`). All armour + jewellery slots carry all six.

| Influence | Exalt | Live |
|---|---|---|
| shaper | Shaper's Exalted Orb | 548c |
| elder | Elder's Exalted Orb | 111c |
| crusader | Crusader's Exalted Orb | 1645c |
| redeemer (eyrie) | Redeemer's Exalted Orb | 480c |
| hunter (basilisk) | Hunter's Exalted Orb | 5483c |
| warlord (adjudicator) | Warlord's Exalted Orb | 2193c |

Awakener's Orb 2467c · Orb of Dominance 4112c (the old **Maven's Orb** name is no longer tracked).

## What was modelled

[src/services/influence.ts](../../src/services/influence.ts):

1. **Index** — `buildInfluenceIndex(baseTags, influence, ilvl, mods)` (augmented-tag pool, influence-only,
   ilvl-gated) + `influenceRollProbability(idx, {group|modId})` (weight / combined pool — an exalt rolls one
   influenced mod across both slots).
2. **`add-influence`** (arity 1) — `P=weight/pool` × the influence's live exalt; specific-named-mod only;
   rejects already-influenced / corrupted; flags that a miss leaves the item influenced (re-roll a fresh base).
3. **`awakeners`** (arity 2, reuses `evaluateInputs([a,b])`) — both influenced, different influence, same class;
   `P(carry both) = 1/nA × 1/nB` with `nX = influenced-affix count`; output gains both influences.
4. **`orb-of-dominance`** (arity 1) — eligible armour (body/boots/gloves/helmet) + ≥2 influenced mods;
   `P(elevate intended)=1/n`; collateral removal of one other influenced mod (certain) modelled.

Item state gained `Affix.influenced` (the carry/elevate count signal). Wired through the existing interface:
`CRAFT_MODULES` + `CraftMethod`/`MethodSpec` kinds + `resolveMethod` passthrough + the `calc_craft_cost` tool
(`add-influence` / `orb-of-dominance` methods, `addInfluence` + `influenced` affix inputs). Awakener's stays on
the arity-2 channel (no new tool — validated via `evaluateInputs`, mirroring recombine).

## Validation (`npm run validate:influence`, live)

| Check | Result |
|---|---|
| Add named Hunter *+%Life* on a no-influence Vaal Regalia | P 22.2% → ~4.5 Hunter's Exalts → **24673c (43.3 div)** ✓ |
| Awakener's — single-influenced-mod donors (Hunter +%Life × Warlord all-res) | **P(carry both)=100%** → 1 Awakener's Orb (4.3 div) + 2 donors ✓ |
| Awakener's — 2-influenced donor | P(carry intended) **50%** (random carry) ✓ |
| Orb of Dominance — elevate (2 influenced) | **P=50%** → ~8224c (14.4 div); collateral removal modelled ✓ |
| Eligibility — add-influence on an influenced item | rejected: *"item already influenced (shaper); … needs a NO-influence rare"* ✓ |
| Eligibility — Orb of Dominance with < 2 influenced | rejected: *"needs ≥2 influenced mods (have 1)"* ✓ |
| Currencies priced live | all six exalts + Awakener's + Orb of Dominance ✓ |
| Parity | 9-case snapshot byte-identical ✓ |

Tests: [test/influence.test.ts](../../test/influence.test.ts) (16) — index isolation/ilvl/codename,
`influenceRollProbability`, add-influence (cost / already-influenced reject / abstract reject), Awakener's via
`evaluateInputs` (guaranteed carry / 2-mod halving / same-influence + class rejects), Orb of Dominance (elevate
prob + collateral / <2 reject / base reject).

## Flags

- **Awakener's carry semantics** (one guaranteed influenced mod per input, then reroll the rest) are
  **community-sourced** — not in the data export. `P = 1/nA × 1/nB` rests on that rule; confirm before trusting
  tight numbers. Single-influenced-mod donors make it a guaranteed transfer (the high-value play).
- **Orb of Dominance:** the elevate **benefit** (Elevated-tier value) is **qualitative** (Elevated values not
  cleanly in the export); the **collateral loss** (one other influenced mod removed) **is** modelled. p90 ≈ 2×
  mean on the 50% branch — budget the tail.
- **Add-influence miss** leaves the item influenced (can't re-exalt) → expected count assumes re-rolling a
  fresh no-influence base per miss, or pivoting to Awakener's.
- Influence currency prices are live; no untracked influence orb this round (unlike the eldritch Annulment).

## Out of scope / next

**Catalysts + Anointing are next** — the two deterministic wins (lean entirely on the weight-index / live
oil + catalyst prices, low variance). No solver, no memory strands, no Track B, no automation.
