# Report — variant-matched unique pricing in build-cost

**Date:** 2026-06-17 · **League:** Mirage (live) · **Status:** 🟢 shipped (2 commits). Gates green (typecheck ✓ · lint ✓ · 425 tests ✓ · build ✓ · **parity snapshot byte-identical**). Pushed.

`estimate_build_cost` now prices the unique **variant the build actually runs** — read from each PoB item's
mods — instead of the priciest confident listing. Build-cost-local: `searchEconomy` / `price_check` /
`appraise` / crafting / solver / recombine are untouched.

## The change (per the diagnostic's numbers)

A per-archetype **variant extractor registry** (`VARIANT_SPECS`, keyed by unique name) maps a PoB item's mods
→ a normalized variant key, joined to the snapshot's per-variant parenthetical label:

| unique | extracted from mod | example | join |
|---|---|---|---|
| Thread of Hope | `Only affects Passives in <R> Ring` | `Large` | label `(Large)` |
| Forbidden Flesh / Flame | `Allocates <Notable> …` | `Unleashed Potential` | label `(<Notable>)` |
| Screams of the Desiccated | the two `<Buff> Shrine Buff` lines | `{Acceleration, Impenetrable}` | label `(A, B)`, **unordered** |
| Voices | `Adds <N> Jewel Socket Passive Skills` | `3` | label `(N passives)`, **numeric** |

- **Build variant not listed → unpriced + low-confidence + note** (no substitution).
- **Fallback** (commit 2) — an *unregistered* multi-variant unique uses the **cheapest confident** listing (a
  floor, flagged), not the max. Single-variant uniques are unchanged.
- Selected variant is exposed on `PricedPiece.variant`.

## Before → after (assert on the variant LABEL — prices drift between pulls)

| piece | OLD selection | NEW selection | direction |
|---|---|---|---|
| Screams of the Desiccated | `(Echoing)` ~838d (priciest *confident*, wrong variant) | **`(Acceleration, Impenetrable)`** ~5,084d *(low-conf: 8 listings)* | the build's actual belt — was too **low** |
| Voices ×3 | `(1 passives)` ~2,467d ea | **`(3 passives)`** ~152d ea | was too **high** |
| Thread of Hope | `(Very Large)` ~13.6d | **`(Large)`** ~1.6d | was too **high** |
| Forbidden Flesh | bare `Forbidden Flesh` ~98.5d | **UNPRICED + flagged** `variant 'unleashed potential' not listed` | correct — not in feed |
| Forbidden Flame | bare `Forbidden Flame` ~24.7d | **UNPRICED + flagged** | correct — not in feed |
| **TOTAL** | **14,790 div** | **5,434 div** | variants now correct (Screams is genuinely an expensive thin-listed belt; Forbidden pair honestly unpriced) |

`Tabula Rasa` (single-variant, items-list) — unchanged (asserted in **chaos** in the unit suite). The wrongly-inflated
220M-chaos / 0-listing outlier the `lowConfidence` sort already dropped is still excluded.

## Tests

- **Live** `estimate_build_cost pob:"pobb.in/0mLsHPwVEPfp"`: Screams→`(Acceleration, Impenetrable)`, Voices×3→
  `(3 passives)`, Thread→`(Large)`, Forbidden pair→unpriced+flagged. ✓
- **Unit (synthetic snapshot, no live dep):** (a) variant identified → that variant selected (Thread `Large`,
  not max); (b) absent variant → unpriced + flagged, never substituted (Forbidden `Unleashed Potential`);
  (c) Screams two-token label matched **unordered** (reversed mod order still matches); (d) Voices **numeric**
  label matched. ✓ (425 tests total, parity byte-identical.)

## Out of scope / notes

- Extractors cover the four archetypes in real builds. Other multi-variant uniques (e.g. Watcher's Eye,
  Impossible Escape) fall to the **cheapest-confident floor** + flag until/unless an extractor is added —
  honest, never inflated.
- Unrelated pre-existing `parse_pob` edge case surfaced in the dump: one item's name parsed as
  `"Unique ID: …"` (it's a rare → unpriced anyway). Flagged for a separate look; not part of this fix.
