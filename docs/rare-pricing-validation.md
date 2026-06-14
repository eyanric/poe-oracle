# Rare-item pricing — validation (Track A completion)

A reusable, confidence-flagged rare-pricing service ([rarePricing.ts](../src/services/rarePricing.ts) +
[pseudoMods.ts](../src/services/pseudoMods.ts)) wired into `calc_craft_cost`'s buy side with a HEDGED
craft-vs-buy verdict. Built reusable — PoB upgrade-pathing will call it directly, so it carries no
craft-specific coupling.

**The honest problem (restated):** rares aren't fungible — there is no single price, only a
distribution of comparable listings. This is the unsolved problem in PoE tooling (even Awakened PoE
Trade is a rough guide). The deliverable is therefore a **documented, confidence-flagged estimator**,
not a claim of accuracy it can't support.

## How it works

1. **Pseudo-mod normalization** — collapse an item's mods into the official trade "pseudo" totals
   (total life, total elemental resistance, total attributes…), so comparables match on what matters,
   not exact rolls. Curated APT-style ruleset (RePoE has no native pseudo grouping). Unit-tested.
2. **Query-builder heuristic** — rank pseudos by importance, drop noise below per-stat floors, collapse
   overlaps (elemental-res aggregate over individual fire/cold/lightning), cap to `maxStats`, and loosen
   each min by `looseness`. `maxStats` / `looseness` / `minInclude` are the tunable knobs. Reuses the
   base→trade-category map from `tradeQuery`.
3. **Distribution → range** — search live trade (cheapest-online via the rate-limited
   `TradeMarketService.searchListings`), trim bait (median−3·MAD), report **low (≈20th pct) → median**
   plus the raw cheapest and the spread. Never the single cheapest as the estimate.
4. **Confidence flags** — few results OR wide spread → low; over-constrained (zero comparables) →
   widen ONCE then say so, never fabricate; identity-only fallback with uncaptured value mods →
   forced low ("base price, not a comparable"); divine-denominated above a few div.

**Rate-limit discipline:** identical specs are cached/deduped (5-min TTL), the widen is bounded to one
retry, and every query flows through the single rate-limited trade path (10s pacing observed, honoured).

## Live validation — `npm run smoke:rare`

Run **2026-06-14**, league **Mirage** (note: late in the league → thinner books than league-start).
4 real rares, easy→hard, with my manual trade read for comparison:

| # | Item | Tool output | Manual read | Verdict |
|---|---|---|---|---|
| A | Vermillion Ring, ~85 life + ~78% ele res, ilvl 84 | queried life≥72, ele-res≥66 → **10 div**, depth **1**, **low conf** | a clean 85-life/78-res Vermillion Ring is ~8–15 div late-league; the lone match is a loaded ring | ✅ in range, correctly **low-conf** on depth 1 |
| B | Two-Toned Boots, 80 life + 30% all-ele + 25% MS | queried life≥56, ele-res≥63 → **10c**, depth **1**, **low conf**, ⚠ *MS not captured* | a 30%-all-res + 25%-MS + 80-life boot is ~5–20 div; **10c is wrong** | ❌ **MISS — see below** (correctly flagged low-conf + uncaptured MS) |
| C | Shaper Vaal Regalia, 120 life + 85% res, ilvl 86 | **NOT PRICED** even after widening (too specific / thin) | such a chest exists but is thin late-league | ✅ correctly **refused to fabricate** |
| D | Imperial Skean, phys/crit/AS dagger | identity-only → **1c**, depth 65, **low conf**, ⚠ *phys, crit, AS not captured* | a good phys/crit dagger is many div; 1c is the bare base | ✅ **MISS by design, correctly flagged** (not high-conf) |

### Where it was off, and why (the honest part)

- **B is the instructive miss.** Movement speed has no pseudo, so the query constrained only life +
  ele-res. The cheapest item matching *just those two* was a worse boot (no good MS) at 10c — the
  classic "too few mods → pricing against a different item." The tool flagged it low-confidence and
  surfaced "MS not captured", so the number isn't presented as trustworthy — but the point estimate is
  wrong. **Fix path:** add movement-speed (and other key non-pseudo explicit stats) to the query
  builder as explicit stat filters, not just pseudos.
- **D is a structural limitation.** Pseudo-pricing covers defensive/attribute stats (life, ES, res,
  attributes) well; it does **not** cover weapon/attack/crit/`%-increased` items. With no value-driving
  mod captured, the service falls back to base identity and now **forces low confidence** with an
  explicit "BASE price, not a comparable" note (this was a high-confidence bug in the first smoke run —
  fixed). Real weapon pricing needs an explicit-stat query path — noted as future work, not faked.
- **A & C show the depth/over-constraint trade-off.** Tight AND-queries on a specific base return thin
  depth (1) or nothing late-league; both are correctly demoted/refused rather than dressed up. Loosening
  the knobs (`maxStats`, `looseness`) trades precision for depth — the documented tuning lever.

## Hedged craft-vs-buy in `calc_craft_cost` — `npm run validate:craft`

The buy side now resolves a rare-comparables RANGE (or a named-aggregator price) and the verdict is
hedged. Live read on the test crafts:

- Essence life-craft (~3.4c) vs Headhunter named price (8.43 div, high conf) →
  **`craft-likely-cheaper` (high conf), ~8.43 div edge** — a crisp margin is shown only because both
  sides are confident and non-overlapping.
- When either side is low-confidence, or the craft point sits inside the buy range, the verdict reads
  **`overlapping — no clear edge`** or a confidence-capped lean with **no crisp single-number margin**
  (unit-tested in [craftCost.test.ts](../test/craftCost.test.ts)).

## What's proven vs not

- **Proven:** the live rare-pricing path works, returns a confidence-flagged range, refuses to fabricate
  when over-constrained, flags uncaptured mods, respects rate limits, and feeds a hedged verdict that
  never over-claims precision.
- **Not claimed:** pricing *accuracy* on hard items. B and D are real misses (defensive-stat bias;
  no weapon/explicit-stat coverage), documented above. This is a guide, not a quote — exactly as scoped.

**Next (out of this pass):** explicit-stat filters for non-pseudo value mods (MS, weapon stats, +1
gems, aspects), and reuse of this service in PoB upgrade-pathing (the coupling-free design supports it).
