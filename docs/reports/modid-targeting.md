# Report — modId-keyed targeting precision

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 355 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

The 3a flag, fixed: targeting a mod by **stat-name / group** is ambiguous — one stat maps to several
distinct mod identities across **domains** (eldritch implicit vs normal explicit), **tiers**, and generation
types, so the producer index conflated them and a live "cheapest" could satisfy the *wrong* identity. This
makes targeting **modId-keyed** and adds the **stat → candidate-modId resolver** (the engine-side prerequisite
for the UI per-mod picker). One concern (targeting identity). Clean-room; analysis-only.

## Lead

- **The engine already reasons in modIds; the gap was the resolver.** `classifyMod` / the `estimateCraftCost`
  matcher / the solver's `modPresent` all key on `modId` **when present** — so a modId-keyed target never
  conflates. The missing piece was a **stat/group → candidate-modId resolver** so a caller (the UI) can pick
  the right identity. Built as `resolveTargets`.
- **`resolveTargets(query, base, ilvl, mods) → TargetCandidate[]`** ([modProducer.ts](../../src/services/modProducer.ts))
  returns the candidate **modIds** across tiers AND domains (explicit / eldritch-implicit / veiled / influence),
  each with `{ modId, group, label (tier text), slot, domain, tier, weight }`. Live on Iron Greaves,
  *"increased Movement Speed"* → **6 explicit tiers + 6 eldritch-implicit tiers + 3 veiled hybrids** — distinct
  identities the picker disambiguates. An unambiguous stat narrows to one domain's tiers; a pseudo stat
  ("Resistance") resolves to the **set** of contributing modIds (64 across 9 groups), not one.
- **Conflation fixed end-to-end.** Targeting the **eldritch-implicit modId** → `classifyMod` = eldritch → the
  search routes **eldritch even though a same-stat explicit is cheaper** (it's a *different* mod). Targeting the
  **explicit modId** → core/explicit (`alt → regal`), never eldritch. The two never collapse.
- **Goal test keyed by modId** — a plan satisfies the **exact** modId; a same-stat sibling does not. **Pseudo /
  aggregate targets preserved** (resolve to a contributing-modId set; the buy-side keeps its pseudo pricing).
  **Pricing keys on the modId's tier text** (the resolver's `label`), so the specific-variant buy-side prices
  the targeted tier, not a sibling. **No regression; parity byte-identical.**

## What changed

- **`resolveTargets` + `TargetCandidate`** ([modProducer.ts](../../src/services/modProducer.ts)) — the
  stat/group → modId disambiguation contract (domain + tier first-class). The single helper the UI per-mod
  picker calls to turn a human stat into the concrete mod identities; the chosen `modId` flows into
  `TargetSpec.desired` / `excluded`.
- **No engine rewrite needed** — `classifyMod` / `modPresent` / the `estimateCraftCost` matcher already prefer
  `modId`. This increment proves that path end-to-end and supplies the resolver that feeds it.

## Validation (`npm run validate:modid-targeting` + `test/targetResolver.test.ts`)

| Check | Result |
|---|---|
| Conflation fixed | eldritch-implicit modId → eldritch route even when a same-stat explicit is cheaper ✓ |
| Distinct identities | same-stat explicit modId → core/explicit route; the two never conflate ✓ |
| modId goal test | a plan satisfies the exact modId, not a same-stat sibling ✓ |
| Resolver — ambiguous | "increased Movement Speed" → multiple candidate modIds (6 explicit + 6 eldritch + 3 veiled tiers/domains) ✓ |
| Resolver — by tier | a stat with multiple tiers → each tier a distinct modId ✓ |
| Pseudo/aggregate preserved | "Resistance" → 64 contributing modIds across 9 groups (a set, not one) ✓ |
| Pricing on the exact modId | the resolver's tier `label` drives the specific-variant buy-side (tier-exact) ✓ |
| No regression | spine / multi-step / producer / reproduction / lock-matrix tests pass; benchable → bench ✓ |
| Parity | snapshot byte-identical ✓ |

Tests: [test/targetResolver.test.ts](../../test/targetResolver.test.ts) (7) — `resolveTargets` ambiguity
(cross-domain, by-tier, pseudo set), and the conflation fix (eldritch modId → eldritch, explicit modId → core,
goal keyed on the exact modId) with synthetic shared-stat mods (a `SharedMS` that is both an explicit prefix
and an eldritch implicit).

## Flags / out of scope / next

- **The UI picker is a separate workstream** — this makes the *engine* accept + reason in modIds; `resolveTargets`
  is the engine↔UI contract (the picker emitting modIds is that chat's job).
- **Pricing** is tier-exact via the resolver's mod **text** (`rarePricing` is pseudo/text-based and can't take a
  raw modId) — author targets with the resolver's `label` for tier-exact comparables.
- **Anoint producer** waits on the notable→3-oil recipe table; **synthesis** producer on the implicit-pool data
  gap (unchanged). Next: wire the **UI per-mod desired/excluded picker → `resolveTargets` → modId-keyed
  `TargetSpec`**. No automation, no Track B.
