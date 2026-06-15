# Report — anoint recipe generation (poewiki Cargo)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 379 tests ✓ · build ✓ · **parity byte-identical**). Pushed to `origin/main`.

Replaced the one-entry anoint seed with the **full 470-recipe amulet table**, generated (not transcribed)
from the poewiki Cargo data. One concern (the anoint data + its generator). Clean-room; analysis-only.

## Lead — the browser-UA hypothesis was right (this unblocks wiki sourcing generally)

- **poewiki Cargo returns 200 with a browser `User-Agent`.** The recurring 403 was the **default fetcher
  UA**, not the IP. A real Chrome UA on Eric's machine passed on the **first request** — no IP tricks, no
  session. **This unblocks poewiki/poedb Cargo sourcing for Code generally** (the synthesis implicit pool is
  the next candidate). The generator fails loud with a "STOP and report, do not fabricate" message if it ever
  gets a 403/429 despite the browser UA.
- **Structured Cargo export, no HTML scraping.** Source = `Special:CargoExport` over
  `blight_crafting_recipes` (schema discovered at `Special:CargoTables`): `id`, `passive_id`, `type`. The
  amulet rows are `type = "UniqueOrAmulet"` (470; the others are `Ring` 91, `InfectedMap` 13 — **excluded**).
  Three joins build each recipe:
  1. `blight_crafting_recipes` ⋈ `passive_skills` on `passive_id = id` → the **notable display name**
     (470/470 resolved, 0 missing).
  2. `blight_crafting_recipes_items` (`recipe_id`, `ordinal`, `item_id`) → the **3 oil metadata ids**, ordered.
  3. `items` (`metadata_id` → `name`) → the **oil names** — resolved from the data, **never assumed**.
- **Why resolving oils from data matters (a transcription would have been wrong):** the oil metadata ids do
  **not** track tier order. `Indigo Oil = Mushrune6b` (not `Mushrune7`), and `Golden = Mushrune12` (not 13).
  Assuming `Mushrune<N>` = the Nth tier would mis-name oils for several recipes — a wrong oil triple is a wrong
  deterministic answer. The generator maps every `item_id` through the `items` table.

## What was built

- **[scripts/gen-anoints.mjs](../../scripts/gen-anoints.mjs)** — `npm run gen:anoints` (live, browser UA +
  400 ms delay) or `-- --cache` (reuse the gitignored `scripts/.cache/` raw pulls; polite on re-runs). Paged
  Cargo fetch, the three joins, in-script asserts, then emits the seam file. **Idempotent** (re-emit from cache
  is byte-identical). This is the **per-league refresh** mechanism.
- **[src/data/anointRecipes.ts](../../src/data/anointRecipes.ts)** — regenerated, **470 amulet recipes**, keyed
  by notable, sorted for stable diffs, with a provenance header (source URL, retrieval date, `npm run
  gen:anoints`). Oils stored **canonically** (sorted by tier) since they're order-independent in game. The
  anchor round-trips: **Whispers of Doom → 3× Golden**.
- **Prismatic handling without breaking the 13-oil contract:** 31 recipes use **Prismatic Oil** (an anoint-only
  exclusive). `OIL_TIERS` stays the canonical 13 (the existing `anoint.test.ts` asserts length 13); Prismatic
  lives in a separate `ANOINT_ONLY_OILS = ['Prismatic']`, and `Oil` is widened to the union. `anoint.ts`
  `isOil` now accepts both, so explicit-Prismatic anoints also validate.
- **[test/anointGen.test.ts](../../test/anointGen.test.ts)** (+6) — asserts the generator's invariants on the
  committed table (anchor, count 200–1000, every recipe = 3 valid oils in canonical order, OIL_TIERS = 13,
  +30 generic-attribute anoints absent). A regen that breaks these fails CI.

## Verify (built into the generator + the test)

| Check | Result |
| --- | --- |
| Browser-UA fetch | **200** on first request (hypothesis confirmed; 403 was the UA) |
| Anchor | **Whispers of Doom → 3× Golden Oil** (round-trips Code's prior seed) |
| Count | **470** amulet recipes (sane; not 1, not 5000) |
| +30-attribute notables absent | Strength/Dexterity/Intelligence not present (removed 3.25 — correctly missing, not errored) |
| Oils valid | every oil ∈ {13 standard + Prismatic}; exactly 3 per recipe; canonical/order-independent |
| Producer still green | `modProducer` resolves all 470 against the table; Whispers solves (depth 1, 3 oils live); non-anointable → no candidate |
| No regression / parity | additive data; 379 tests pass (+6); **parity snapshot byte-identical** (no `.snap` changes) |

## Flags / next

- **Amulet anoints only.** Ring (`type=Ring`, 91) and blight-map (`InfectedMap`, 13) recipes are separate
  Cargo sets — noted, not included; cheap to add later (same generator, different `type`/oil handling).
- **Spot-check before high-stakes use.** The data is verifiable (not hand-typed) and the anchor is correct, but
  deterministic recipes warrant a live-game spot-check of a couple more notables before relying on them blindly;
  the table ships low-confidence in the producer until then.
- **Wiki sourcing is unblocked for Code** (browser UA). Next data candidate: the **synthesis implicit pool**
  (poewiki Cargo), which was the other "not in the export" gap.
- Then: the **UI per-mod picker → `resolveTargets` → modId/`minTier`/anoint `TargetSpec`** (pinned UI work).
- No automation, no Track B.
