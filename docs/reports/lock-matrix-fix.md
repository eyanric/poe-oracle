# Report — Metamod lock-interaction matrix (correctness fix)

**Date:** 2026-06-15 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 348 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

A guide-validation pass against the **poewiki *Metamod* page (May 2026)** and **Maxroll *Crafting Resources*
(Oct 2025)** found our "Prefixes/Suffixes Cannot Be Changed" interaction matrix **wrong** — in the shipped 3b
reproduction model, the original Harvest module, and the in-repo docs. One concern (the lock matrix), corrected
to a **single source of truth**. Clean-room; analysis-only.

## The corrected matrix (current 3.28)

| Interaction | Methods | Effect |
|---|---|---|
| **RESPECT** | Chaos, Veiled Chaos, Exalted (slam), Annulment, Divine, Alteration/Regal, **Harvest reforge**, **Orb of Scouring**, bench/multimod + all additive | affect only the **unlocked** side; locked side untouched ⇒ **no reproduction** |
| **IGNORE** | **Awakener's Orb**, **Orb of Dominance** (Maven's), **Orb of Unravelling** | reforge/affect **everything** incl. the locked side ⇒ reproduction applies |
| **BLOCKED** | **Essence**, **Fossil** | the game refuses them on a Cannot-Be-Changed item ⇒ **illegal moves**, never generated |

Sources: poewiki *Metamod* (Chaos keeps existing prefixes under "Prefixes Cannot Be Changed"); Maxroll
*Crafting Resources* ("Harvest reforges respect Cannot Be Changed, unlike Fossils and Essences").

## What was wrong → fixed

1. **Harvest reforge: IGNORE → RESPECT.** This is the most common real finishing technique
   (`lock prefixes → harvest-reforge suffixes`); we were **overcharging** it with a phantom reproduction term
   and flagging it DANGEROUS. Now: `respectsLocks = true`, no DANGER note, **zero** reproduction.
2. **Scour: IGNORE → RESPECT.** Scour on a locked item keeps the metamod-protected side (removes only the
   unlocked side). The solver's scour successor now keeps locked-side affixes; `respectsLocks = true`.
3. **Essence / Fossil: usable → BLOCKED.** Illegal on a Cannot-Be-Changed item — the solver now **filters
   them out** of move generation when such a lock is present (not merely costs them differently).
4. Chaos / Alt / Exalt / Annul / Divine / Veiled-Chaos were already correct (respect); Awakener's / Dominance
   already correct (ignore).

## What changed (single source of truth)

- **[src/services/lockMatrix.ts](../../src/services/lockMatrix.ts)** (new) — `LOCK_INTERACTION` map +
  `lockInteraction` / `respectsLock` / `blockedOnLockedItem`. The **one** place the matrix lives.
- **[solver.ts](../../src/services/solver.ts)** — `respectsLocksOf` reads the matrix (the hard-coded
  `LOCK_IGNORING_METHOD_KINDS` set is gone); `expand` filters **BLOCKED** specs once a lock is on the state;
  the **scour** move respects locks (keeps the locked side, `respectsLocks = true`).
- **[harvest.ts](../../src/services/harvest.ts)** — `respectsLocks: respectsLock('harvest')` (= true), DANGER
  note replaced with a "respects — rerolls only the unlocked side (safe)" note; header corrected.
- **[craftModule.ts](../../src/services/craftModule.ts)** — `respectsLocks` doc points to the matrix.
- Docs: corrected the harvest reports' "ignores meta-locks / DANGER" claims (banner + strikethrough).

## Validation (`npm run validate:lock-matrix` + `test/lockMatrix.test.ts`)

| Check | Result |
|---|---|
| Harvest reforge respects | `lock + harvest 430c` == `lock + chaos 430c` (reproduction 0) ✓ |
| Scour respects | `respectsLock('scour') = true`; successor keeps the locked side ✓ |
| Essence / Fossil blocked | not generated as moves once a Cannot-Be-Changed lock is present (search test) ✓ |
| Ignore set unchanged | Awakener's / Dominance / Unravelling still ignore → `430 + 10` reproduce ✓ |
| Respect set unchanged | Chaos / Exalt / Annul / Divine / Veiled-Chaos still respect (no regression) ✓ |
| Reproduction math intact | `planExpectedCost` unchanged except for the reclassified moves; MC ≈ closed-form ✓ |
| No regression | spine / multi-step / producer / reproduction / harvest tests pass (old-matrix cases updated) ✓ |
| Parity | snapshot byte-identical ✓ |

Tests: [test/lockMatrix.test.ts](../../test/lockMatrix.test.ts) (5) — the respect/ignore/blocked sets, the
helpers, and the solver filtering Essence on a locked item. Updated: [test/harvest.test.ts](../../test/harvest.test.ts)
(respects + safe note) and [test/solverReproduction.test.ts](../../test/solverReproduction.test.ts) (the
lock-ignoring example relabelled from harvest to Orb of Dominance).

## Flags / next

- Harvest has been reworked across leagues; "Harvest reforge respects Cannot Be Changed" is the current
  high-confidence consensus (Maxroll Oct 2025 + poewiki May 2026) — confirm the specific 3.28 reforge crafts
  in-game, but shipped to this matrix.
- The solver's auto-proposed move set doesn't include Awakener's/Dominance/Unravelling (not single-item
  producers), so the IGNORE set is documented in the matrix but only the respect/blocked rows affect generated
  plans today.
- Next: the **anoint producer** (recipe table) + the **UI per-mod desired/excluded picker → modId-keyed
  `TargetSpec`** (the pinned UI work). No automation, no Track B.
