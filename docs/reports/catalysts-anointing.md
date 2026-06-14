# Report — Catalysts + Anointing (Tier-1 deterministic wins)

**Date:** 2026-06-14 · **League:** Mirage (live) · **Status:** shipped in two commits, gates green (typecheck ✓ · lint ✓ · 283 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

Two small **deterministic** modules. Both lean on live prices; anointing also needed a new **live oils**
feed (added to the economy snapshot). Clean-room; analysis/information only; manual-invoke; no automation.

## Lead

- **Catalyst = magnitude scaling only (deterministic).** Quality (cap 20%) scales the *values* of
  matching-tag mods on ring/amulet/belt: Prismatic 20% ⇒ **×1.20** on resistance (e.g. +11% Fire Res → 13.2).
  Cost = catalysts to target quality × live price (Prismatic ~13× → **10.4 div**), risk **deterministic**.
- **⚠ SOURCING CORRECTION — roll-weight bias is defunct.** The prompt asked to model catalyst "roll-weight
  bias" through the weight-index. That mechanic was **removed in patch 3.15.0**; in 3.28 catalysts **only**
  scale magnitude, they do **not** change roll chances ([PoE wiki / fandom](https://pathofexile.fandom.com/wiki/Catalyst)).
  So it is **deliberately NOT modelled** (flag-don't-invent) — the weight-index is not involved for catalysts.
- **⚠ Tempering is a CORE defence catalyst**, not Mirage (despite the prompt grouping). Only the targeted
  **Sinistral / Dextral** catalysts are league-gated to Mirage (reuses the Rancour gating).
- **Anoint = a named-notable 3-oil recipe lookup (deterministic, P=1).** *Whispers of Doom* → 3× Golden Oil →
  **1.7 div**, priced live. The module also accepts **explicit oils** so it costs *any* anoint live (Clear +
  Sepia + Amber = 3c).
- **Live oils added to the economy snapshot** (poe.watch `oil` category — 14 oils). Previously oils weren't in
  the feed; now Golden 326c, Silver 168c, etc. resolve.
- **Parity snapshot byte-identical** — both modules are additive.

## Module A — Catalysts (commit 1)

[src/services/catalysts.ts](../../src/services/catalysts.ts):

- **Catalyst→tag map (⚠ CURATED, PoE wiki — not in the export):** abrasive→attack, accelerating→speed,
  fertile→life/mana, imbued→caster, intrinsic→attribute, noxious→physical/chaos, prismatic→resistance,
  tempering→defences, turbulent→elemental. Sinistral/Dextral target a **slot** (prefix/suffix), not a tag.
- **Magnitude:** `×(1 + quality/100)` on matching-tag mods, quality capped at 20 (so ×1.20 max). Deterministic.
- **Roll-weight bias:** NOT modelled (removed 3.15.0) — flagged in every result.
- **Cost:** `catalystCount × live catalyst price`. The per-catalyst quality gain is ilvl-dependent (~1–2% at
  high ilvl ⇒ ~10–20 to cap) and **not in the export** → a flagged representative count (13) is used.
- **Eligibility:** ring / amulet / belt; Sinistral/Dextral **league-gated to Mirage** (`isLeagueActive`,
  the Rancour path). A named desired mod is checked for the catalyst tag (won't-boost is flagged).

Wired: `CRAFT_MODULES` + `CraftMethod`/`MethodSpec` + `resolveMethod` + the `calc_craft_cost` tool
(`catalyst` + `quality`). Tests: [test/catalysts.test.ts](../../test/catalysts.test.ts) (9).

## Module B — Anointing (commit 2)

[src/services/anoint.ts](../../src/services/anoint.ts):

- **Oils added to the economy layer** (`economyTypes.oils` ← poe.watch `oil` category, threaded through both
  providers + `economySearch`) so the 3 oils price live. 14 oils resolve in Mirage.
- **Recipe resolution:** a **named notable** → the curated **seed** recipe table, OR **explicit 3 oils** →
  priced directly (so any anoint is costable without the full table). Deterministic (P=1).
- **⚠ Seed recipe table (curated, flagged):** the full ~455-combination notable→recipe table is **not in the
  export** (Blight anoint data). Seeded with the confirmed *Whispers of Doom = 3 Golden Oil*; unseeded
  notables are **rejected** with "supply oils / populate from poedb" (flag-don't-invent).
- **Specific-named-notable only:** abstract anoint (no notable, no oils) → unsupported. Amulet eligibility.
- **Variants (flagged, NOT modelled):** ring anointing (Blight-ravaged), cluster-jewel anoints, Blight-unique
  enchant pools, and the **Mirage Cord Belt** (anointable as an amulet — would league-gate).

Wired: `CRAFT_MODULES` + `CraftMethod`/`MethodSpec` + `resolveMethod` + the `calc_craft_cost` tool (`notable`
+ `oils`). Tests: [test/anoint.test.ts](../../test/anoint.test.ts) (9).

## Validation (`npm run validate:catalysts` / `validate:anoint`, live)

| Check | Result |
|---|---|
| Catalyst magnitude (Prismatic 20% on a ring) | resistance **×1.20** (+11% → 13.2) ✓ |
| Catalyst deterministic cost to 20% | ~13 × Prismatic → **10.4 div**, risk deterministic ✓ |
| Catalyst roll-weight bias | NOT modelled (removed 3.15.0) — flagged ✓ |
| Catalyst Mirage gating | Sinistral rejected in Standard, ok in Mirage; **Tempering core** (ok in Standard) ✓ |
| Anoint named notable (Whispers of Doom) | 3× Golden Oil → **1.7 div**, deterministic P=1 ✓ |
| Anoint explicit oils | Clear + Sepia + Amber → 3c (prices any anoint) ✓ |
| Anoint rejects | ring base / unseeded notable / abstract / wrong-count / unknown-oil all rejected ✓ |
| Live oils | 14 oils in the snapshot (Golden 326c, Silver 168c) ✓ |
| Parity | 9-case snapshot byte-identical ✓ |

## Flags

- **Catalyst roll-weight bias removed in 3.15.0** — modelled magnitude only (the weight-index reuse the prompt
  expected does not apply to catalysts post-3.15).
- **Tempering = core defence catalyst** (not Mirage); only Sinistral/Dextral are Mirage-gated.
- **Catalyst→tag map** is curated (PoE wiki), not in the export; **quality-per-catalyst** (~10–20 to cap) is
  ilvl-dependent and flagged representative.
- **Anoint notable→recipe table** is a curated seed; the full table must be sourced from poedb. Explicit-oils
  pricing covers everything else.
- Anoint **variants** (ring / cluster / Blight-unique / Mirage Cord Belt) are flagged, not modelled.
- Oils now live via poe.watch; no untracked-currency manual hook needed this round.

## Out of scope / next

Per the roadmap, **Tier 2** follows: Veiled/Aisling, Synthesis, Memory strands + Hinekora's Lock. No solver,
no memory strands yet, no Track B, no automation.
