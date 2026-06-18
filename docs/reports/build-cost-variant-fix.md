# Report — build-cost variant pricing: STOPPED (prompt root-cause is wrong)

**Date:** 2026-06-17 · **Status:** 🟡 **stopped and reporting** — the requested change does not fix the bug; the real cause is the one the prompt put out of scope. No code committed; working tree reverted clean.

## TL;DR

The fix prompt's confirmed root cause — *"a belt (Screams of the Desiccated) name-matched into the Unique
**Jewel** bucket"* — **is not what happens.** Screams is a belt and is correctly in the Unique **Accessory**
bucket; it is **not in the jewel bucket at all**. The inflation is the **`chaosValue`-DESC tiebreak picking the
most-expensive variant** among 48 same-name belt listings — which is the variant/tiebreak logic the prompt
explicitly said **"do not change."** So the class-constraint change can't fix this symptom, and the real fix is
out of the prompt's scope. Stopping per the standing rule (flag-don't-invent; report rather than hollow out).

## Evidence (live Mirage snapshot)

`Screams of the Desiccated` in the PoB parse: `baseType = "Leather Belt"`, `slot = "Belt"` → a **belt**.

Where it lives in the snapshot:

| bucket | hits |
|---|---|
| `uniqueAccessories` | **48** (e.g. `Screams of the Desiccated (Greater Skeletal, Replenishing)` …) |
| `uniqueJewels` | **0** |
| `uniqueArmours` | 0 |

Variant price spread within the accessory bucket: **min 13.09c · median ~4,962c · max 207,149,521c**
(≈ 375,000 div). `searchEconomy` sorts `lowConfidence → score → chaosValue DESC`; every variant prefix-matches
the query equally, so the tiebreak returns the **max** → the build line was 6,203 div (earlier snapshot) and
would be ~375k div on this one. That single outlier variant is the whole bug.

## I did implement the requested change — and verified it is a no-op here

I added the class-constrained lookup exactly as specified (an optional `unique:<bucket>` sub-category on
`searchEconomy`; derive each PoB unique's bucket from baseType/slot in `gearListFromPob`). It is correct and
parity-safe, and I confirmed the bucketing:

| piece | base / slot | bucket | correct? |
|---|---|---|---|
| Screams of the Desiccated | Leather Belt / Belt | **accessory** | ✓ |
| Voices ×3 | Large Cluster Jewel | jewel | ✓ |
| Thread of Hope | Crimson Jewel | jewel | ✓ |
| Forbidden Flesh/Flame | Cobalt/Crimson Jewel | jewel | ✓ |
| The Gull | Raven Mask / Helmet | armour | ✓ |
| Replica Dreamfeather | Eternal Sword / Weapon 1 | weapon | ✓ |

Re-running live, **every piece — Screams included — was byte-for-byte unchanged** (total still 14,790 div,
Screams still 6,202.7 div). Because Screams was never cross-bucket; constraining it to `unique:accessory` still
finds the same 48 variants and the same max-tiebreak picks the same outlier. The prompt's own validation ("Screams
moves") therefore fails. I **reverted** the change rather than commit a no-op "fix" under a false premise. (It is a
reasonable *defensive* hardening on its own — a belt genuinely *can't* leak into jewels — but it is not this bug,
so it shouldn't ride this commit.)

## The real fix (needs your go-ahead — it's the part the prompt excluded)

The defect is in **same-name variant selection / the price tiebreak**. Options, smallest-first:

1. **Tiebreak by a robust statistic, not the max.** Among same-name matches, pick the **median** (or a
   low-percentile) chaosValue instead of `chaosValue DESC` — kills the 207M-chaos outlier. Smallest change;
   fixes Screams and any other multi-variant unique. ⚠ This *does* alter `searchEconomy`'s tiebreak, which the
   prompt forbade — so it needs your explicit OK.
2. **Drop thin/outlier listings first** (`listingCount` floor) — the 207M variant is almost certainly a
   near-zero-supply mislisting. Complements (1).
3. **Principled (the separate pinned feature):** read the build's *actual* variant from the item's mods and
   price that specific variant via mod-filtered trade. Correct but much larger.

My original MCP-surface report already named this correctly ("the matcher … grabs an extreme-priced variant …
instead of the right/median one"); the fix prompt re-attributed it to a bucket leak. Recommend a corrected
increment targeting option (1)+(2).

## Gates

No code change shipped (reverted). Nothing to gate; parity untouched by definition.
