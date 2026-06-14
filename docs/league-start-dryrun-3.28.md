# League-start pipeline — 3.28 (Mirage) dry-run

**Purpose:** de-risk the deadline-bound Track B by running the full league-start pipeline end to end
against **real 3.28 data**, well before the 3.29 reveal (July 16, 2026). Run: `npm run dryrun:league`.

**What this proves:** the plumbing, contracts, and cost math work on real data.
**What it does NOT prove:** predictive quality — that rides on the runtime reasoning layer (Claude's
meta web-search + judgment) and is only testable once 3.29 data exists. See the explicit split below.

Run date **2026-06-14**, live league **Mirage**, prices via poe.watch. **Plumbing green.**

---

## B1 — patch-notes ingestion

Source: the real 3.28.0 notes ([pathofexile.com/forum/view-thread/3913392](https://www.pathofexile.com/forum/view-thread/3913392)),
captured as a canonical section+bullet corpus ([test/fixtures/patch-notes-3.28-mirage.txt](../test/fixtures/patch-notes-3.28-mirage.txt)).

Parsed (`parsePatchNotes`) → league **Mirage**, version **3.28.0**, with every category populated:

| sections | skills | uniques | mechanics | buffs | nerfs | currency |
|---|---|---|---|---|---|---|
| 11 | 18 | 9 | 18 | 14 | 11 | 10 |

**Captured (spot-check):** new skills (Divine Blast, Holy Hammers, Blessed Call Support), Exceptional
Support Gems, `Sweep → Holy Sweep`; uniques (Lioneye's Glare, Pledge of Hands, Replica Gifts from
Above); Atlas rework (centre start, Favoured Maps removed); nerfs (Earthshatter, Static Strike);
currency shifts (Coin of Knowledge, Cartographer's Chisels removed, "Exalted & Regal comparatively
more common"). The full raw text is retained per-section so nothing is dropped.

**Parser limits (honest):** the buff/nerf split is keyword-heuristic (e.g. a line with both "reduced"
and "increased" gets both tags) — it surfaces candidates, it is not authoritative. On the **live**
forum HTML (vs this clean corpus) the `stripHtml` step removes markup but surrounding nav text can
create junk "sections"; the dry-run runs on the real-content corpus to isolate the parser. Live-HTML
content extraction is the one refinement to harden before relying on the live fetch for 3.29.

## B2 — build-cost estimation (live)

Two known 3.28 builds priced live and auto-tiered:

| Build | Pieces (live) | Total | Tier |
|---|---|---|---|
| Starter (RF-style) | Tabula 5c · Goldrim 3c · Wanderlust 3c · Lifesprig ×2 7c | ~18c (**0.03 div**) | **starter** |
| Endgame mapper | Headhunter 8.5 div · Mageblood 128.2 div | **135.61 div** | **aspirational** |

Totals come out in chaos **and** divine; thin/unpriced legs are flagged and the total is treated as a
lower bound (rares aren't indexed by aggregators). The tier thresholds (≤10 div starter, ≤100 div
functional, else aspirational) are heuristic and tunable.

## B3 — synthesis against the contract

A `LeagueStartPlan` was assembled (standing in for the runtime reasoning layer, using the real 3.28
signals above) and **passed `validateLeagueStartPlan`** (required identity + ≥1 build + ≥1 farm/flip
priority + the mandatory predictive caveat). Dry-run output:

- **Builds:** `[starter] RF Inquisitor (~0.03 div)` · `[aspirational] Headhunter mapper (~135.6 div)`
- **Early spikes:** Exalted/Regal Orbs `[medium]` (patch makes them "comparatively more common" +
  bench standardized to Exalts); Mirage Wishes `[low]` (new mechanic farmed hard early).
- **Farm/flip:** 0–48h run Mirage Wishes + flip cheap uniques/currency · 48–72h map for Voidstones,
  flip Exalted/Regal as bench demand ramps.

### Sanity-check vs what actually happened in Mirage (directional)
The flagged signals are *consistent* with the real 3.28 patch (Exalt/Regal commonality + bench-to-Exalt
standardization were genuine economy levers; Mirage Wishes were the headline farm). This is a
**consistency check on the inputs**, not a measured prediction-accuracy result.

---

## Proven vs not — read this before trusting the output

| ✅ Proven by this dry-run (plumbing) | ❌ NOT proven here (reasoning) |
|---|---|
| Patch notes fetch + parse into lossless structured categories on real data | That the *right* builds/items were flagged |
| Build costs are real, live, divine-denominated, confidence-flagged, auto-tiered | That tier thresholds map to "good league-start value" |
| Plan output has a validated shape with an enforced honesty caveat | Prediction accuracy of spikes / farm priorities |
| The 4-step workflow runs end to end and exits green | Live-forum-HTML extraction robustness (corpus used here) |

Predictive quality is **inherent to the reasoning layer** and only testable once 3.29 data exists. The
skeleton is standing and dry-run-green; the July 16→24 task is: register the 3.29 source, re-run, refine.
