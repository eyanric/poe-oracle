# Report — craft risk scoring (cost distribution, not just EV)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, gates green (162 tests).

`calc_craft_cost` reported an *expected* cost. A craft's cost is actually a **distribution**, and the
craft-vs-buy call should be **risk-adjusted**, not EV-only. This adds a cost distribution, a
determinism score, brick-point detection with value-at-risk, a one-line risk category, and folds all
of it into the hedged verdict. Foundational increment — no new crafting methods, no new method data,
no Track B, no automation. Clean-room; layering held; existing hedged + low-confidence discipline intact.

## What shipped

### Phase 1 — cost distribution ([services/craftRisk.ts](../../src/services/craftRisk.ts))
A craft is modelled as a priced **CraftPlan** of steps: `keep-trying` (geometric, `p`/attempt),
`fixed` (guaranteed one-off), `slam` (one high-variance attempt; `recoverable` miss = cheap retry,
otherwise a **brick**). `costDistribution` returns `mean / p50 / p90 / p95`:
- **Point** when fully guaranteed (essence).
- **Closed-form** for a single geometric step + fixed terminals: percentile attempts =
  `ceil(ln(1−q)/ln(1−p))` → cost (p90 ≈ 2.3× mean for small p — asserted in tests).
- **Monte Carlo** (seeded `mulberry32`, default 10k trials) for compound sequences / bricks, with
  restart-on-brick so the "sometimes you brick and rebuild" cost is captured. Seeded ⇒ reproducible.

### Phase 2 — determinism + bricks
- **Determinism score (0→1, 1 = fully deterministic):** `guaranteedCostShare × (1 − brickPenalty)`,
  with the inputs (`guaranteedCost`, `probabilisticCost`, `brickPenalty`) exposed — not a black box.
  *(Note: Phase-2 prose said "0 = deterministic" but the validation example said essence ≈ 1.0; I took
  the intuitive, validation-consistent orientation: **essence → 1.0**, pure gamble → 0.)*
- **Brick points:** each unrecoverable step → `failureProb` + **value-at-risk** (EV invested before it +
  its own cost — what a brick destroys).
- **Risk category:** `deterministic` / `grind` (bounded downside, cheap tries) / `gamble` (few expensive
  swings) / `high-brick` (unrecoverable downside present).

### Phase 3 — risk-adjusted verdict ([craftCost.ts](../../src/services/craftCost.ts))
Each supported method is mapped to a CraftPlan (per-attempt consumable → keep-trying; terminals →
fixed); the estimate now carries a `risk` profile, and the hedged verdict gains `p90Chaos`,
`riskCategory`, `riskAdjusted`, `riskNote`. **The verdict shifts beyond EV:** if **p90 craft > buy
price** or there's a **material brick**, it calls buying the safer play *even when expected craft <
buy* — and says why (variance / brick). Crisp margins still only when both sides confident AND
non-overlapping; hedged language kept for overlaps.

## Validation — spanning the spectrum

Cases 1–2 are LIVE (`npm run validate:craft`, Mirage); case 3 exercises the brick machinery via a
synthetic plan (unprotected exalt slam) since no brick *method* exists yet (next track).

| Case | Result | Match? |
|---|---|---|
| **Essence forced mod** (Deafening Greed → Vaal Regalia) | category **deterministic**, determinism **1.0**, p90 = mean = 4.7c, **no brick**, zero variance | ✅ |
| **Alt-spam one mod** (Increased Life prefix) | category **grind**, mean 2.7c → **p90 5.1c (1.9× mean)**, no brick; verdict shows `[p90 …]` | ✅ p90 > mean, bounded |
| **Unprotected exalt slam** (synthetic: built base 100c + 20% slam) | category **high-brick**, determinism **0.19**, brick **80% chance to lose 105c** (value-at-risk), MC mean ≈ 525c; `hedgedVerdict` flips an EV-cheaper craft (500c < 1000c buy) to **buy-likely-cheaper (risk-adjusted)** citing the brick | ✅ verdict leans buy despite competitive EV |

p90 ≈ 2.3× mean sanity check passes for small p (`geomQuantileAttempts`). Monte Carlo is seed-stable
(identical p90 across runs).

### Where the score felt slightly off (honest note)
The determinism score is **cost-share based**, so on a *cheap* craft where a guaranteed terminal is a
big slice of total spend it can read higher than the "it's a gamble per attempt" feel — e.g. alt→regal
where the one guaranteed Regal is a large fraction of a sub-3c total nudges determinism up even though
each alt is a coin-flip. The **risk category** (`grind`) is the better quick-read there, which is why
the verdict and output lead with the category, not the raw score. Documented rather than papered over.

## Gate status
typecheck ✅ · lint ✅ (layering green) · **162 tests** ✅ (+18: craftRisk 15, craftCost risk/verdict 3)
· build ✅ · `validate:craft` ✅ (live, risk fields).

## Out of scope / next
- No new crafting methods (the brick `slam`/`annul` *methods* — and the plans that use them in
  `calc_craft_cost` — are the next track; the risk engine already supports the step type + Monte Carlo
  restart, validated synthetically here). No Track B; no automation.
