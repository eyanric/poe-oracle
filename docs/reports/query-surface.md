# Report — craft query surface (the front door)

**Date:** 2026-06-16 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 395 tests ✓ · build ✓ · **parity byte-identical**). Pushed to `origin/main`.

Exposes the resolve → pick → solve flow through the MCP tools: a **`resolve_target`** tool + **`solve_craft`
that accepts human stat queries**. The separate UI picker consumes the same contract. One concern (the query
surface). Clean-room; analysis-only.

## Lead

- **`resolve_target`** ([tools/query.ts](../../src/tools/query.ts)) wraps `resolveTargets` → the candidate mod
  **identities** for a stat on a base: `{ modId, label, domain, slot, tier, weight }`. `resolveTargets`
  ([modProducer.ts](../../src/services/modProducer.ts)) now surfaces **all six domains** — `explicit`,
  `eldritch-implicit`, `veiled`, `influence`, and the new **`anoint`** (amulet notables in the recipe table)
  and **`synthImplicit`** (the per-class synthesis pool). So the disambiguation entry point covers every
  producer the solver can reach.
- **`solve_craft` accepts human targets** ([tools/craft.ts](../../src/tools/craft.ts)): each desired/excluded
  entry is a **stat `query`** OR a **pinned `modId`/`group`** (+ optional `domain`, `minTier`, `anoint`,
  `synthImplicit`). The composition is `solveCraftQuery` ([solver.ts](../../src/services/solver.ts)):
  - **Unambiguous** (one identity, possibly several tiers — or the caller pinned `domain`/modId) → straight to
    `searchPlans` → ranked plans.
  - **Ambiguous** (a stat that maps to several distinct identities — a Hunter implicit vs a same-stat explicit
    are different crafts) → a **disambiguation response** listing the candidates with a "re-call with the
    chosen modId" message. **It never guesses** which identity the user meant; the response `kind` distinguishes
    `solved` / `disambiguation` / `unresolved`.
- **Producer slots are opt-in, not noise.** `anoint` and `synthImplicit` occupy the enchant/implicit slot, not
  an affix slot — so a bare affix query (`"maximum Life"`) defaults to the **affix** domains (and stays
  unambiguous when it can), while the enchant/implicit producers are reached by pinning `domain`/the flag, or
  automatically when they're the *only* match (e.g. a notable name like `"Whispers of Doom"` has no affix
  collision → resolves straight to the anoint). This avoids making every `+life` query ambiguous **without ever
  silently choosing between same-slot affix identities** (the conflation the flag-don't-invent rule targets).

## The resolve → pick → solve round-trip

**1. Explicit (unambiguous, auto-solves):**
```
solve_craft { base:"Two-Stone Ring", ilvl:84, desired:[{ query:"increased Light Radius" }] }
→ kind:"solved" · cheapest: alt → regal ≈ 15c · verdict (one affix identity → no disambiguation)
```

**2. Explicit (ambiguous → disambiguate → pick → solve):**
```
solve_craft { base:"Iron Greaves", ilvl:84, desired:[{ query:"increased Movement Speed" }] }
→ kind:"disambiguation" · candidates across [explicit, eldritch-implicit, veiled]   (does NOT pick)
solve_craft { …, desired:[{ query:"increased Movement Speed", domain:"explicit" }] }     (or pin the modId)
→ kind:"solved" · cheapest: essence (Wailing Essence of Zeal)
```

**3. Anoint (producer domain, no affix collision → auto-solves):**
```
resolve_target { query:"Whispers of Doom", base:"Onyx Amulet", ilvl:84 }  → 1 candidate · domain:anoint
solve_craft   { base:"Onyx Amulet", ilvl:84, desired:[{ query:"Whispers of Doom" }] }
→ kind:"solved" · anoint "Whispers of Doom" ≈ 1494c (3 Golden Oil, deterministic)
```

**4. Synthesis (producer domain, opt-in):**
```
resolve_target { query:"maximum Life", base:"Two-Stone Ring", ilvl:84 }  → …includes domain:synthImplicit
solve_craft   { …, desired:[{ query:"...", domain:"synthImplicit" }] }   → synthesis-reroll producer
   (plan ranking is gated on the Vivid Vulture price — a beast not in the feed — flagged, not invented)
```

## Output ergonomics

A `solved` response carries the existing `MultiStepResult`: ranked plans (ordered moves, `expectedChaos`/`p90`,
per-attempt P, depth, confidence + **flags**) and the **craft-vs-buy verdict** vs the live specific-variant
price. The low-confidence flags propagate through (bench amounts unverified, synthesis uniform, Vivid Vulture
manual price, stale data) so the calling model can surface them. `resolve_target` and the disambiguation branch
render compact identity tables (modId · domain · slot · tier · label) for clean presentation.

## Validation (`npm run validate:query-surface`, live)

| Check | Result |
| --- | --- |
| `resolve_target` ambiguous | "increased Movement Speed" (Iron Greaves) → 19 candidates across explicit/eldritch/veiled/synthImplicit |
| `resolve_target` unambiguous | "increased Light Radius" (Ring) → 1 affix identity |
| `resolve_target` pseudo | "Resistance" (Ring) → 49 candidates across 8 groups (contributing set) |
| `solve_craft` modId | pinned modId → solved (alt → regal) — unchanged path |
| `solve_craft` unambiguous stat | "increased Light Radius" → resolves → solved (≈15c) |
| `solve_craft` ambiguous stat | "increased Movement Speed" → **disambiguation**, 15 candidates, does NOT pick |
| Producer domains flow through | anoint stat → producer → plan (1494c); synthImplicit resolves → reroll producer (gated on Vulture price) |
| Verdict + flags surfaced | solved response carries verdict (`buy-likely-cheaper`, conf) + propagated flags |
| No regression / parity | additive; 395 tests (+8 querySurface); **parity snapshot byte-identical** |

## Flags / out of scope / next

- **The rich interactive UI picker is the separate UI workstream** — it consumes `resolve_target` +
  `solve_craft` (this contract), now both drivable so chat has a real backend.
- **Pricing-by-label seam unchanged** — rare pricing stays text/pseudo-based via the resolver's tier `label`;
  working, not touched here.
- **Synthesis plans need a supplied Vivid Vulture price** to rank (beast not in the feed) — the producer is
  proposed, the ranking is gated (flagged).
- ORACLE is now usable end-to-end through the MCP tools. Remaining roadmap (your call): a **method-module
  validation sweep** vs the now-Code-fetchable wiki, **Tier-3 breadth** (beast / lab-enchant, data already
  located in pob-data), **real-export `parse_pob` validation**, or **Track B** prep (3.29 reveal ~July 16).
- No automation, no Track B.
