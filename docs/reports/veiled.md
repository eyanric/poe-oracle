# Report — Veiled crafting (Tier-2, post-Syndicate-rework)

**Date:** 2026-06-14 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 292 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

Veiled crafting CORRECTED for the Syndicate rework: **Aisling safehouse slams are gone**. Veiled mods are now
added via the **Veiled Chaos Orb** (reroll + guaranteed veiled, cheap/destructive) or the **Veiled Exalted
Orb** (clean add to an open slot, expensive/non-destructive). Reuses the weight machinery + blocking +
item-state ops. Clean-room; analysis-only; manual-invoke.

## Lead

- **Unveil P(desired) with the blocking lever.** P(desired among the 1-of-3) = `1-(1-share)^3` over the
  `unveiled`-domain pool. **Pre-blocking unwanted high-weight veils shrinks the pool and raises P.** On
  Fingerless Silk Gloves (prefix veils): desired *increased Life* **21.7% → 38.2%** after blocking the 3
  heaviest veils.
- **Veiled Chaos vs Veiled Exalt — same pool, opposite tradeoff.** Identical P(desired) (same draw); they
  differ only in **cost + item-state effect**. For the 38.2% target (~2.6 orbs): **Veiled Chaos ≈ 0.5 div
  (DESTRUCTIVE** — rerolls the whole item, wipes existing mods) vs **Veiled Exalt ≈ 52 div (CLEAN add** to an
  open slot). **109× price gap** — the premium for the no-reroll, no-protection finish.
- **Veiled = a NORMAL affix slot** (stronger than the bench version), modelled on the explicit pool — not a
  crafted slot.
- **Both orbs priced live** (Veiled Chaos 104c, Veiled Exalted 11321c). **Parity byte-identical.**

## Mechanics modelled (current 3.28)

[src/services/veiled.ts](../../src/services/veiled.ts):

- **Pool:** `buildVeiledPool(baseTags, affix, ilvl, mods, exclude)` over the **`unveiled` domain** (the real
  1-of-3 outcomes, spawn-weighted by item-type tag). The `veiled` domain holds only placeholders. `exclude`
  removes **blocked + already-present** groups — the pre-blocking lever.
- **Unveil odds:** `unveilShare` (weight/pool for a named mod) → `pUnveil = 1-(1-share)^3` (the `pPresentInSlots`
  approximation, flagged).
- **`veiled-chaos`** — reroll + guaranteed veiled. P(desired) = the unveil P; **DESTRUCTIVE** (wipes existing
  explicit mods — flagged with the wiped-mod count; high brick risk on a valuable item). Retries are clean
  (each reroll re-veils).
- **`veiled-exalt`** — clean add to an **open** affix slot (else **unsupported** — "use Veiled Chaos to
  reroll"). Same unveil P; **NON-DESTRUCTIVE**. A wrong unveil needs an annul before re-exalting (retry loop
  flagged, not folded into the EV).
- **Same-pool invariant:** both compute P from the identical pool ⇒ P(desired) is byte-identical between them;
  only the consumable (price) and destructiveness differ.

Specific-named-veil only (abstract → unsupported). Wired through `CRAFT_MODULES` + `CraftMethod`/`MethodSpec` +
`resolveMethod` + the `calc_craft_cost` tool (`veiled-chaos` / `veiled-exalt`, using the existing
`blockedGroups` / `affixes` inputs for the blocking lever).

## Validation (`npm run validate:veiled`, live)

| Check | Result |
|---|---|
| Unveil P(desired) without blocking | *increased Life* share 7.8% → **P(in 3) 21.7%** ✓ |
| Unveil P(desired) WITH blocking 3 heavy veils | share 14.8% → **P(in 3) 38.2% ↑** ✓ |
| Veiled Chaos (destructive reroll) | ~2.6 orbs → **272c (0.48 div)**; wipes 2 existing mods (flagged) ✓ |
| Veiled Exalt (clean add) | ~2.6 orbs → **29649c (52.5 div)**; non-destructive ✓ |
| Same-pool check | P identical (38.2% both); **price gap 109×** ✓ |
| Veiled Exalt, no open slot | unsupported — "use Veiled Chaos to reroll" ✓ |
| Veiled = normal-slot (not crafted) | modelled on the explicit/unveiled pool ✓ |
| Parity | 9-case snapshot byte-identical ✓ |

Tests: [test/veiled.test.ts](../../test/veiled.test.ts) (9) — pool build/ilvl-gate/affix-filter, exclude
(blocking) raising share, `unveilShare`/`pUnveil`, destructiveness flag, same-pool P invariant, blocking
raises P, Veiled Exalt open-slot requirement, abstract + not-in-pool rejects.

## Flags

- **Aisling / safehouse slam REMOVED** (Syndicate rework) — not modelled.
- **Veiled = normal-slot mod**, not a crafted slot.
- **P(in 3)** uses the `1-(1-share)^3` independence approximation (consistent with the rare-reroll model);
  exact without-replacement is a small correction at typical shares.
- **Member-specific unveil sub-pools** (Leo/Catarina/… each unveil a member list) are a flagged refinement —
  the model uses the full `unveiled` pool for the base + affix.
- **Veiled Exalt retry** needs an annul of the wrong veil (non-destructive to other mods); that loop is flagged,
  not folded into the EV. Veiled Chaos retries are clean but destructive.

## Out of scope / next

**Synthesis is next** (fractured-item fusion into synthesised implicits), then **Memory strands + Hinekora's
Lock**. No solver, no Track B, no automation.
