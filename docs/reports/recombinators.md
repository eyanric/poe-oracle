# Report — Recombinators (arity-2 combine, two-item stress test)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, gates green (211 tests, parity intact).

The first **arity-2** method (two-item combine), PoE 1 Settlers-of-Kalguur ruleset. The real point — proven
— is the arity-2 contract working end to end; the same plumbing later carries Awakener's Orb (merge two
influences) and Synthesis (fuse fractured items). No solver, no Track B, no automation. Clean-room.

## Lead — arity-2 exercised end-to-end + parity intact; contract change

- **Arity-2 routed for real** through a new `evaluateInputs(inputs, data, params)` that dispatches on the
  module's declared **arity** and passes a genuine **2-item InputSet** `[a, b]` to the recombine module.
  Two input item-states → an outcome/cost result. Validated live.
- **Contract change (reported, not worked around):** the v2 refactor defined `InputSet = [s] | [a, b]` and
  arity in the *types*, but the only entry point (`evaluateMethod`) built a 1-element InputSet — so there
  was no real second-input channel. Fix is additive: `evaluateInputs` is the general entry (with an arity
  check + the league gate); `evaluateMethod(state,…)` now delegates to it with `[state]`. No behaviour
  change for arity-1 methods.
- **Parity:** the 9-case method-matrix snapshot is **byte-identical** — recombine is purely additive.

## Confirmed vs flagged (the quantitative data)

| Piece | Status |
|---|---|
| Recombinator currency items | ✅ **confirmed** in export: `Armour` / `Weapon` / `Jewellery Recombinator` (StackableCurrency); module picks by item class |
| Base 50/50 + inheritance + output ilvl `min(max, floor(avg)+2)` | ✅ modeled (ilvl validated: 84,80 → 84) |
| Independent prefix/suffix pools, 3/3 cap | ✅ modeled + tested |
| Stage-B selection (which mods survive, without replacement) | ✅ **exact** (`C(n−d,c−d)/C(n,c)`; the (3/4)(2/3)(1/2)=25% case unit-tested) |
| Exclusive-mod collision (≤1 survives ⇒ wanting two = brick) | ✅ structure modeled; **flagged** — the exclusive SET has no clean flag in the export (67 scattered text hits, not a tag), so exclusivity is **caller-supplied** (`Affix.exclusive`), `costConfidence:'low'` |
| **Stage-A count distribution** (pool size → P(final count)) | ⚠ **low-confidence** — NOT in repoe-fork; community data is small-sample (per the guides). Encoded as a single flagged representative table; correct in place when a better source lands |
| Recombinator currency live price | ⚠ **does not resolve in Mirage** (Settlers mechanic) — flagged unpriced; input-item values (caller-supplied) still cost correctly |
| 3.28 availability | ⚠ **league-gated** `['Settlers','Kalguur']` → flagged "not active in Mirage" until confirmed (same path Rancour uses) |

## Implementation

- **[services/recombine.ts](../../src/services/recombine.ts):** `pSlotSurvive(n,d)` (Stage-A flagged ×
  Stage-B exact), `nCr`, `recombineIlvl`, `analyzeRecombine(a,b,desired)` (pools, P(prefix)/P(suffix)/
  P(target), exclusive collision, "desired must exist on an input" guard), and `recombineModule`
  (`arity: 2`, `leagues: ['Settlers','Kalguur']`).
- **Cost:** per-attempt = 1 recombinator currency + the **two input items** (consumed each try), folded into
  one keep-trying step via a new direct-`chaos` `extra` channel (also fixes multi-currency pricing
  generally). `estimateRecombine` / `estimateRecombineLive` price it + run the risk engine.
- **Tool:** `calc_recombine` (two input specs with `desired`/`exclusive` affix flags) → P(target),
  brick %, expected attempts, cost (chaos+div), risk.

## Validation (LIVE — `npm run validate:recombine`)

- **Concrete combine** (two rings; want Life+FlatPhys prefixes): prefix pool 3 / suffix pool 2
  (independent), **P(target) 45.0%** (= prefixes 45.0% × suffixes 100%), **brick 55.0%**, ~2.2 attempts,
  output **ilvl 84**, two input items folded into per-attempt cost. ✅
- **Exclusive collision:** two exclusive desired mods → **guaranteed brick** (unsupported, "≤1 survives"). ✅
- **League gating:** `calc_recombine` in the live Mirage league → "league-specific (Settlers/Kalguur), not
  active in Mirage" (flagged until availability confirmed). ✅
- **Currency pricing:** Jewellery Recombinator not in the Mirage snapshot → flagged unpriced (honest;
  it's a Settlers mechanic). ✅

Unit tests ([test/recombine.test.ts](../../test/recombine.test.ts), 12): nCr, Stage-B exact compounding,
junk-lowers-survival, ilvl, every Stage-A row sums to 1, independent pools, absent-mod guard, exclusive
collision, arity-2 via `evaluateInputs` (+ arity-mismatch rejection), league gating.

## Gate status
typecheck ✅ · lint ✅ (layering) · **211 tests** ✅ (+14: recombine 12, contract 2) · build ✅ ·
`validate:recombine` live ✅ · **parity snapshot byte-identical**.

## Out of scope / next
No solver, no memory strands, no Track B, no automation. The arity-2 plumbing is now proven for
**Awakener's Orb** and **Synthesis**. Per the roadmap, the Tier-1 coverage cluster
(eldritch / influence / catalysts / anointing) follows. Carried flags: confirm recombinator 3.28
availability; source the real Stage-A count distribution + the exclusive-mod set.
