# Report — anoint producer (diagnosis-first sourcing)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 373 tests ✓ · build ✓ · **parity byte-identical**). Pushed to `origin/main`.

Turns an **anointable-notable target** into the deterministic 3-oil anoint recipe, priced live, wired into
the producer index + solver. One concern (anoint producer + its sourcing). Clean-room; analysis-only.

## Step 1 — source diagnosis: the recipe table is ABSENT from Code-fetchable exports

Checked, in order:

| Source | Result |
| --- | --- |
| PoB `pob-data/poe1/Misc.json` (`.min` too) | **200**, but only monster/game constants (`characterConstants`, `monsterLifeTable`, …) — **no anoint data** |
| Rest of `pob-data/poe1/` | only `Costs.json` + `ClusterJewels.json` resolve; `Oils/Anoints/Anointments/Notables/BlightOils/Enchantments/Passives/tree` → **404** |
| Main `repoe-fork.github.io` base | `blight_crafting_recipes/blight/oils/anoints/anointments/enchantments/helmet_enchants` → **404**; only `cluster_jewel_notables.json` (cluster-jewel data, **not** amulet anoints) |
| PoB community repo (`PathOfBuildingCommunity/PathOfBuilding`) | **no** oil/anoint/blight `.lua`/`.json` data file — PoB computes anoints in code |

**Conclusion: ABSENT.** The notable→oil mapping is Blight crafting data (`BlightCraftingRecipes`) and isn't
exported anywhere Code-fetchable. Per the brief's absent branch, I **built the producer seam** and the recipe
lives as a **hand-sourced SEED** in [data/anointRecipes.ts](../../src/data/anointRecipes.ts) (documented
schema, keyed by notable) — **no recipes fabricated** (a wrong oil triple is a wrong deterministic answer).
The seed carries the one verified entry (Whispers of Doom = 3 Golden); populate the full ~455-notable amulet
table from poedb and verify a sample.

## What was built

- **Recipe data file** ([data/anointRecipes.ts](../../src/data/anointRecipes.ts)): owns `OIL_TIERS`, `Oil`,
  `ANOINT_RECIPES` (the seed), `isAnointableNotable`. The oil/recipe data moved **into the data layer**
  (was in `services/anoint.ts`); `anoint.ts` now imports + re-exports it (downward layering; the existing
  `anoint.test.ts` surface is unchanged). The sourcing diagnosis is documented in the file header.
- **Enchant-slot model** ([itemState.ts](../../src/services/itemState.ts)): `ItemState.anoint?: string` (one
  notable in the enchant slot) + `withAnoint`. It does **not** consume affix capacity and is folded into
  `stateKey` (so the search dedupes correctly). Affix caps / `openSlots` are untouched by an anoint.
- **Producer** ([modProducer.ts](../../src/services/modProducer.ts)): an anoint target (`anoint: true`, modId =
  the notable) classifies **only** against the recipe table on an amulet base → `{ kind: 'anoint', notable }`,
  short-circuiting the affix producers (an enchant is disjoint from influence/eldritch/veiled). Non-anointable
  notable, or non-amulet base ⇒ **no candidate** (no false positive).
- **Solver** ([solver.ts](../../src/services/solver.ts)): `SpecificMod.anoint?`; `modPresent` matches the
  enchant slot (`state.anoint === notable`); `applyProduce` routes an anoint to `withAnoint` (not `withAffix`);
  `methodSpecsFor` returns only the anoint producer for a lone anoint target; `expand` splits each anoint into
  its own enchant-slot move (so a **mixed** affix+anoint amulet target composes across depth). The costing path
  (`MethodSpec {kind:'anoint'}` → `resolveMethod` → `anointModule` → 3 oils priced live) already existed.

## Validation (`npm run validate:anoint-producer`, live)

| Check | Result |
| --- | --- |
| Source diagnosed | Misc.json + siblings + main base + PoB repo checked → **absent**, seed in data/anointRecipes |
| Anointable notable solves | `Whispers of Doom` on Onyx Amulet → `anoint "Whispers of Doom"`, depth 1, 3 Golden Oils, **1409c live** (Mirage) |
| Deterministic | P=1; plan `p90 == expectedChaos` (no spread) |
| Non-anointable notable | → classes `[core]`, **0 plans** (not guessed) |
| Slot model | enchant slot; open prefix/suffix unchanged 3/3 before & after; present anoint ⇒ depth 0 |
| Oil pricing live | 3-oil cost tracks the `oil` economy category; an unpriced oil is flagged, recipe kept |
| Non-amulet base | ring → no anoint candidate (ring anoints are a separate set, flagged) |
| No regression / parity | additive producer; 373 tests (+8 anointProducer); **parity snapshot byte-identical** (no `.snap` changes) |

## Craft-vs-buy

The anoint producer feeds the solver's existing specific-variant craft-vs-buy: the 3-oil cost (live) competes
with buying a pre-anointed comparable. For a cheap notable the deterministic anoint is the cheap route and
ranks first; an expensive triple (e.g. 3 Golden) can lose to buying — surfaced via the standard verdict.

## Flags / out of scope / next

- **Seed accuracy:** anoints are deterministic, so the producer ships **low-confidence** until the table is
  verified against the live game. Recipes are added only when confirmed — never inferred from oil tiers.
- **Amulet only.** Ring anoints (Blight-ravaged) and cluster-jewel anoints (1 oil) are **separate sets** —
  rejected here (no false positive), flagged for later if cheap.
- **UI resolver:** notables aren't in the affix pools, so `resolveTargets` returns nothing for a notable query
  — the anoint target is named directly (`anoint: true`). A notable→anoint UI resolver is a separate, flagged
  follow-up (pairs with the pinned per-mod picker work).
- **Synthesis** producer still blocked on the implicit pool (poedb, Claude-side extraction — later).
- Roadmap intel: the PoB export also has `BeastCraft.json`/`Enchantment*` — clean Code-fetchable sources for
  the Tier-3 beastcraft / lab-enchant methods when we reach them.
