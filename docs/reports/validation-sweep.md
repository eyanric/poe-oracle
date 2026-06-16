# Report — method-module validation sweep (phase 1: mechanics + availability)

**Date:** 2026-06-16 · **League:** Mirage (3.28, live) · **Status:** sweep complete; 1 module fixed, rest confirmed or flagged. Gates green (typecheck ✓ · lint ✓ · 395 tests ✓ · build ✓).

A systematic trust audit: per module, verify **availability** (obtainable now?) and **load-bearing
parameters** (the ones that move a cost/probability/verdict) against the current wiki (poewiki Cargo,
browser-UA fetch — the now-Code-fetchable source). Sources cited per row. Flag-don't-invent: wiki for
mechanics, **Eric for current-league availability**.

## Scoreboard

**11 modules · 1 stale-fixed · 9 confirmed-inert · 4 items flagged for Eric.** The only code change is the
harvest amounts (cited below); every confirmed module changed **zero bytes**.

## ⚠ FOR ERIC — availability/ambiguity only you (live) can settle

These are **not** in the code as guesses; they're flagged here for your call:

1. **Recombinators — 3.29 availability.** Currently gated to `['Settlers','Kalguur']` → **off in Mirage**,
   which the wiki corroborates (`drop_enabled = 0`). Correct *now*. **If 3.29 reintroduces them, add the
   league to `recombine.ts`'s `leagues`.** Until you confirm, it stays gated off.
2. **Mirage-gated crafts die ~3.29.** Crystallised Rancour reforges (minion/attribute/mana) and the
   Sinistral/Dextral catalysts are Mirage (3.28) content (Rancour is `release_version 3.28.0`). When Mirage
   ends they rotate out — confirm and flip the gates if needed.
3. **Synthesis implicit-count distribution `75/19/6`** (1/2/3 implicits) is datamined from Harvest league —
   no better source found this sweep. Verify in-game, or accept as best-available (flagged low-confidence).
4. **Harvest standalone "remove [tag]" craft** is **not** in the current Cargo set (`harvest_crafting_options`)
   — removal is bundled into the augment ("add a new X and remove another random"). The module still exposes a
   `remove` kind (amount 30, flagged). Confirm it's truly gone; if so we drop the `remove` kind.

## The fix (this sweep) — harvest amounts

**`harvestCrafts.ts`** — verified against poewiki Cargo `harvest_crafting_options` (74 options, exact
`cost_wild/vivid/primal/sacred/rancour`). The colour→tag mapping confirmed unchanged; amounts corrected:

| Craft | tag | old (code) | new (Cargo) | source |
|---|---|---|---|---|
| reforge | physical | 75 (default) | **50** | `Reforge … Physical` vivid:50 |
| reforge | critical | 75 (default) | **150** | `Reforge … Critical` primal:150 |
| reforge | speed | 75 (default) | **150** | `Reforge … Speed` vivid:150 |
| augment | attack | 15000 ("confirmed") | **17500** | `Add a new Attack…` wild:17500 |
| augment | chaos | 15000 | **17500** | `Add a new Chaos…` vivid:17500 |
| augment | critical | 17500 ("confirmed") | **20000** | `Add a new Critical…` primal:20000 |

The prior "confirmed" transcription for attack/critical augments was **wrong** — exactly the drift this sweep
exists to catch. All standard reforge/augment amounts are now Cargo-confirmed (reforge 50/75/100/150; augment
15000/17500/20000 + 1 Sacred); Rancour reforge amounts also matched Cargo exactly → marked confirmed. Harvest
is **not** in the parity matrix, so the snapshot is unchanged (the corrected costs flow through `harvest.test`).
Commit: `fix(harvest): correct reforge/augment amounts from poewiki Cargo`.

## Audit table — always-available methods

| Module | Availability (source) | Load-bearing params | Status |
|---|---|---|---|
| `essenceCrafts` | **core** — data-derived | repoe-fork essences = **106**, exactly matches wiki `essences` (106); corrupted essences (Horror/Delirium/Hysteria/Insanity) present; tiers Whispering→Deafening current | **confirmed** (export tracks current; cross-checked count) |
| `fossilCrafts` | **core** (Delve) — data-derived | 25 fossils, current names; mod bias = export added/forced/negative weights (Pristine→life, Aberrant→chaos, …) | **confirmed** (data-derived; count current) |
| `harvestCrafts` | **core** (Sacred Grove); Rancour = Mirage | reforge/augment SET + amounts + colour→tag | **stale-fixed** (amounts, above) + Rancour confirmed; `remove` kind flagged |
| `eldritch` | **core** (Eldritch Altars) — wiki `items` drop=1, v3.17 | 4 ember/ichor tiers (Lesser/Greater/Grand/Exceptional) ✓; implicit pool data-derived; base-variant cost pool | **confirmed** (tier names + availability) |
| `benchCrafting` | **core** — data-derived | metamod costs (multimod/lock 2 Div, cannot-roll 1 Div); **lock matrix** (Harvest/Scour respect; Essence/Fossil blocked; Awakener's/Dominance/Unravelling ignore) | **confirmed** — lock matrix already corrected (poewiki May2026 + Maxroll Oct2025), not re-drifted. ⚠ bench *amounts* = standing flag (override seam, bench-cost-fix) |
| `influence` | **core** — wiki: Awakener's/Crusader's/Hunter's Exalted Orb not removed | conqueror codenames (crusader=Crusader, eyrie=Redeemer, basilisk=Hunter, adjudicator=Warlord); `{slot}_{codename}` pools data-derived; Awakener's carry | **confirmed** (orbs current; pools data-derived; codenames stable) |
| `catalysts` | **core**; Sinistral/Dextral = Mirage | 9 stat catalysts + tag map (abrasive→attack … turbulent→elemental); **no roll-weight bias** (3.15); quality cap 20% | **confirmed** — wiki catalyst list matches the 9; 10th (Unstable) is quality/corruption, correctly excluded from the magnitude map |
| `veiled` | **core** — wiki: Veiled Chaos Orb (v3.26) + Veiled Exalted Orb (v3.14) not removed | post-Syndicate unveiling; **Aisling removed** (correctly not modeled); unveiled-domain pool data-derived; same-pool both orbs | **confirmed** (orbs current; Aisling correctly absent) |

## Audit table — league-rotating methods (availability is the question)

| Module | Availability (source) | Params | Status |
|---|---|---|---|
| `recombine` | **off in Mirage** — wiki `Armour/Weapon/Jewellery Recombinator` **drop_enabled = 0**; module gated `['Settlers','Kalguur']` | Settlers NNN native/non-native rules; count dist (flagged representative) | **confirmed gating** (correctly unavailable now) → **3.29 = flag for Eric** |
| `memoryStrands` | **core since 3.26** — wiki: Orb of Remembrance + Orb of Unravelling `release_version 3.26.0`, `drop_enabled = 1`, **not removed** | strand-craft / Remembrance / Unravelling mechanics; magnitudes (STRAND_BOOST/STRANDS_PER_CRAFT/UNRAVEL — flagged caller-overridable) | **availability confirmed** (the "core since 3.26" claim is correct); magnitudes remain the standing flag |
| `synthesis` | **core** (Synthesis map device + Harvest synthesise) | synthesise eligibility/cost (lifeforce, live-priced); implicit pool (sourced from Cargo, prior increment); **count dist 75/19/6** | **availability confirmed**; pool current; **count dist = flag for Eric** (datamined, no better source) |

## Method (how the sweep was run)

poewiki Cargo via `Special:CargoExport` (browser UA, polite delay, raw pulls cached in `scripts/.cache/`).
Tables used: `essences`, `items` (availability via `drop_enabled`/`release_version`/`removal_version`),
`harvest_crafting_options` (exact lifeforce costs), the `synthesis_*` set (prior increment). Data-derived
modules (essence/fossil/veiled/influence/bench pools) were cross-checked at the export level — the essence
count matching wiki exactly (106) is strong evidence repoe-fork is current 3.28, so those modules' pools are
as current as the export.

## Phase 2 (flagged, not done here)

- **Deep re-models** if a mechanic changed substantially (none found this sweep — harvest was an amount
  correction, not a re-model).
- The **for-Eric** availability calls above (recombinator 3.29, Mirage rotation) — settle, then flip gates.
- Anything wiki couldn't settle (synthesis count dist) stays flagged, not guessed into code.
