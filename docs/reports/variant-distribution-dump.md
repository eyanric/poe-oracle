# Report — variant distribution dump (build-cost uniques)

**Date:** 2026-06-17 · **League:** Mirage (live, poe.watch) · **Read-only diagnostic — no code changed.** Source build: `pobb.in/0mLsHPwVEPfp` (Scion). Snapshot item shape: `{ name (variant embedded in parens), baseType, chaosValue, divineValue, listingCount, lowConfidence, source }`. Divine ≈ 429c at pull time.

## Headline for the fix design

- **The current tiebreak is wrong in BOTH directions** — too **high** for Thread of Hope / Voices, too **low** for Screams. So no single statistic (max *or* median *or* lowest) is correct.
- **Median is unsafe (confirmed):** it would price Screams at 3,765c when the build's *actual* variant is 3,000,811c, and Voices at 36,608c — neither is the build's variant.
- **The build's variant IS in the parse** (Q4 ✓) and the snapshot **does** carry per-variant labels + `listingCount` (Q6 ✓) — but the two vocabularies need **per-archetype extraction to join** (Q5), and sometimes the build's exact variant **isn't listed at all** (Forbidden pair) → must flag, not substitute.
- `searchEconomy`'s `lowConfidence`-first sort **already drops 0-listing mega-outliers** (Screams' 220M-chaos `listings=0` variant is excluded) — so the remaining defect is selection *among confident variants*, which `listingCount` filtering alone won't fix.

## Per-unique distributions (variant · chaos · div · listings · lowConf)

### Screams of the Desiccated — bucket **accessory**, 48 variants · min 13.9c / **median 3,765c** / max 220,559,649c
| variant | chaos | div | listings | lowConf |
|---|--:|--:|--:|---|
| (Echoing, Resistance) | 220,559,649 | 514,640 | **0** | true |
| (Acceleration, Resistance) | 75,020,289 | 175,047 | **0** | true |
| (Diamond, Resistance) | 13,362,988 | 31,180 | 3 | true |
| **(Acceleration, Impenetrable) ← BUILD'S ACTUAL** | **3,000,811** | **7,001** | 8 | true |
| **(Echoing) ← SELECTED today** | 359,434 | 838 | 21 | false |
| … cheapest (Greater Shocking) | 13.9 | 0.0 | 164 | false |

Selected = "(Echoing)" 838d (rank 12/48, 77th pctile) — the priciest **confident** variant, **not** the build's. Build runs **(Acceleration, Impenetrable)** (its PoB mods grant *Acceleration* + *Impenetrable* shrine buffs) = **7,001d / 8 listings** — i.e. the build's true variant is *more* expensive than the selected one. Median (3,765c) matches neither.

### Voices — bucket **jewel**, 4 variants · min 1.3c / **median 36,608c** / max 1,057,266c
| variant | chaos | div | listings | lowConf |
|---|--:|--:|--:|---|
| **(1 passives) ← SELECTED** | 1,057,266 | 2,467 | 33 | false |
| (3 passives) | 73,188 | 170 | 49 | false |
| (5 passives) | 28 | 0.1 | 131 | false |
| (7 passives) | 1.3 | 0.0 | 179 | true |
Selected = "(1 passives)" **2,467d** (max, rank 1/4, and it's a *confident* 33-listing entry → `listingCount` floor won't drop it). Build's PoB mod: *"Adds 3 Jewel Socket Passive Skills"* → maps toward "(3 passives)" (170d) — needs numeric interpretation, not a string match. Either way the build is **not** the 2,467d 1-passive variant.

### Thread of Hope — bucket **jewel**, 5 variants · min 15c / **median 914c** / max 5,825c
| variant | chaos | div | listings | lowConf |
|---|--:|--:|--:|---|
| **(Very Large) ← SELECTED** | 5,825 | 13.6 | 71 | false |
| (Medium) | 1,663 | 3.9 | 83 | false |
| **(Large) ← BUILD'S ACTUAL** | 914 | 2.1 | 70 | false |
| (Small) | 178 | 0.4 | 199 | true |
| (Massive) | 15 | 0.0 | 925 | false |
Selected = "(Very Large)" 13.6d (max); build's PoB mod: *"Only affects Passives in **Large** Ring"* → **(Large)** = 2.1d (exists, 70 listings). **Cleanest join** (radius word ↔ label). Median (914c) is coincidentally ≈ Large here — luck, not principle.

### Forbidden Flesh — bucket **jewel**, 157 variants · min 2.4c / median 112c / max 187,306c
Selected = bare "Forbidden Flesh" **98.5d** (rank 4/157). Build's PoB mod: *"Allocates **Unleashed Potential**"* → **no `(Unleashed Potential)` variant exists in the feed** (labels are notables: *(Avatar of the Wilds)*, *(Unbreakable)*, *(Gore Dancer)*, *(Mastermind of Discord)*, …). The build's true variant is **unlisted** → correct answer is *unpriced + flagged*, not any substitute.

### Forbidden Flame — bucket **jewel**, 157 variants · min 4.8c / median 150c / max 218,348c
Selected = bare "Forbidden Flame" **24.7d** (rank 11/157). Same story: build grants *Unleashed Potential*; no matching variant in the feed → should be unpriced + flagged.

## Answers to the decision questions

**Q4 — Is the build's variant identifiable from the parse? YES, for all five** (the variant-defining line is in the PoB item's mods):
| unique | variant axis | what the parse exposes |
|---|---|---|
| Thread of Hope | radius | `"Only affects Passives in Large Ring"` → **Large** |
| Forbidden Flesh/Flame | granted notable | `"Allocates Unleashed Potential …"` → **Unleashed Potential** |
| Screams of the Desiccated | shrine-buff pair | `"… Acceleration Shrine Buff …"` + `"… Impenetrable Shrine Buff …"` → **(Acceleration, Impenetrable)** |
| Voices | passive count | `"Adds 3 Jewel Socket Passive Skills"` → a **count** (≈ "(3 passives)") |

**Q5 — Do the vocabularies join? Related, but NOT a 1:1 string match — needs per-archetype extraction:**
- **Thread of Hope:** clean — the radius word (`Large`) equals the snapshot label `(Large)`. ✓
- **Forbidden Flesh/Flame:** the notable name joins to the label (`(Avatar of the Wilds)` etc.) — but the build's notable (**Unleashed Potential**) **is absent from the feed entirely**, so the join legitimately yields *no match*.
- **Screams:** the build's two shrine-buff mods must be assembled into the 2-axis label `(Acceleration, Impenetrable)` — a real join exists (7,001d/8 listings) but requires composing two mod lines into the snapshot's `(A, B)` format.
- **Voices:** the parse gives `"Adds 3 …"` (a number) vs the label `(3 passives)` — needs numeric extraction, and the PoB phrasing ("Jewel Socket Passive Skills") doesn't verbatim-match "passives".
- So: **no generic string-equality join**; each archetype needs a small extractor (radius / notable / shrine-pair / count).

**Q6 — Supply signal present? YES.** Every variant carries `listingCount` (e.g. Screams (Greater Shocking) 164, (Acceleration, Impenetrable) 8, the 220M outlier **0**) plus a `lowConfidence` flag. So thin-supply filtering is *possible* — and the `lowConfidence`-first sort already uses it to drop 0-listing outliers. **But it is not sufficient:** the wrongly-selected variants (Voices 1-passive 33 listings, Thread Very-Large 71 listings) are *confident*, so a `listingCount` floor wouldn't correct them.

## Recommended fix shape (for the real increment, on these numbers)

1. **Variant-match from the parse** — extract the build's variant per archetype (radius / notable / shrine-pair / passive-count) and join to the snapshot's parenthetical label. This is the only approach that's right for all five.
2. **When the build's variant isn't listed (Forbidden → Unleashed Potential): unpriced + low-confidence + note.** Do not substitute another variant's price.
3. **Fallback when no variant info / un-joinable:** prefer a **confident low-percentile** (cheapest non-lowConfidence), **not** max and **not** median — median demonstrably regresses Screams/Voices.
4. A class-bucket constraint (the prior prompt) is still a fine independent hardening, but it does not touch this defect.
