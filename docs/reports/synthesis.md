# Report — Synthesis (Tier-2, corrected core mechanics)

**Date:** 2026-06-14 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 301 tests ✓ · build ✓ · parity snapshot byte-identical). Pushed to `origin/main`.

Synthesis modelled on its **current core** mechanic — the league Synthesiser (Memory Nexus) fractured-item
**fusion is GONE** and is **not** modelled. Core Synthesis is **arity-1**: the **Harvest "synthesise"
transform** + the **Beast (Vivid Vulture) reroll**. Clean-room; analysis-only; manual-invoke.

## Lead

- **⚠ CORRECTED mechanic:** synthesised gear is made by the **Harvest synthesise** craft (Namharim recipe),
  not by fusing three fractured items. The targeting step is the **Vivid Vulture beastcraft** (rerolls one
  synthesis implicit). No arity-2 fusion.
- **⚠ DATA GAP (the headline finding):** the synthesised-item **implicit pool is NOT in the repoe-fork export.**
  The `synthesis_a` / `synthesis_globals` / `synthesis_bonus` domains the prompt named are **Synthesis MAP /
  Memory-Nexus mods** (e.g. *"(40-50)% increased number of Rare Monsters"*, *"Doubles the values of Memory
  Modifiers"*) — **not gear implicits**. There is no item-implicit synthesis `generation_type` and no separate
  file (probed `synthesis*.min.json` → all 404). So **`P(desired implicit) = weight/pool` cannot be resolved
  from the data** — the per-base synthesis implicit list must be sourced from poedb.
- **Harvest synthesise transform is fully modelled + priced live:** `5000 Vivid + 1 Sacred Crystallised
  Lifeforce` → **~2.9 div** (lifeforce prices live), deterministic. Implicit-**count** distribution (datamined
  Harvest league): **75% → 1 · 19% → 2 · 6% → 3** (E≈1.31), flagged.
- **Vivid Vulture reroll modelled as keep-trying** with a **flagged caller-supplied pool size** (uniform
  `1/N` until the real pool is sourced); the Vivid Vulture beast isn't in the price feed → manual-price hook.
- **Eligibility enforced:** influenced / fractured / corrupted inputs rejected; **eldritch ⊥ synthesis**
  (eldritch currency deletes synthesis implicits) flagged. **Parity byte-identical.**

## Sourced facts (flagged — verify against the live game)

| Fact | Value | Source / confidence |
|---|---|---|
| Synthesise recipe | Harvest "synthesise" (defeat Namharim, Born of Night) | [PoE wiki](https://www.poewiki.net/wiki/Synthesised_item) — high |
| Synthesise cost | **5000 Vivid + 1 Sacred Crystallised Lifeforce** | wiki — medium (verify current) |
| Implicit count | **75% / 19% / 6% → 1 / 2 / 3** (E≈1.31) | datamined **Harvest league** — flagged |
| Targeting | **Vivid Vulture** beastcraft rerolls one synthesis implicit | wiki / beast recipe — high |
| Input restrictions | non-influenced, non-fractured, non-unique, non-synthesised, non-corrupted | wiki — high |
| eldritch ⊥ synthesis | eldritch currency works but **deletes** synthesis implicits | wiki — high |
| **Implicit pool + weights** | **NOT in repoe-fork** (synthesis_* = map mods) | probed — **data gap** |

## What was modelled

[src/services/synthesis.ts](../../src/services/synthesis.ts):

1. **`synthesise`** (arity 1, deterministic) — `synthesiseEligibility` (reject influenced via the shared
   `isInfluenced`, fractured, corrupted) → consumes `5000 Vivid + 1 Sacred` lifeforce (priced live via the
   `currency` category, the same path as Harvest). Notes carry the count distribution, the eldritch ⊥
   synthesis warning, and the pool data-gap.
2. **`synthesis-reroll`** (arity 1, keep-trying, Vivid Vulture) — specific-named implicit only; **requires a
   flagged `poolSize`** (the pool isn't in the export) → `P = 1/poolSize` (uniform approximation, flagged);
   expected rerolls × Vivid Vulture (a beast — not price-tracked → manual-price hook, incomplete total
   flagged). Without `poolSize` it is **unsupported** with the data-gap message (flag-don't-invent).

Wired through `CRAFT_MODULES` + `CraftMethod`/`MethodSpec` + `resolveMethod` + the `calc_craft_cost` tool
(`synthesise` / `synthesis-reroll` + `poolSize`).

## Validation (`npm run validate:synthesis`, live)

| Check | Result |
|---|---|
| Harvest synthesise transform | 5000 Vivid + 1 Sacred → **1635c (2.9 div)**, deterministic ✓ |
| Implicit count rule | 75/19/6 → E≈1.31, sourced + flagged ✓ |
| Eligibility — influenced | rejected ("cannot synthesise an influenced item") ✓ |
| Eligibility — corrupted / fractured | rejected (see tests) ✓ |
| Vivid Vulture reroll — no poolSize | unsupported (pool not in export — flag) ✓ |
| Vivid Vulture reroll — poolSize=20 | P 5% → ~20 vultures; Vivid Vulture unpriced (manual) ✓ |
| `P(desired)` via weight-index on synthesis domains | **NOT done — those are map mods (data gap, corrected)** ✓ |
| Parity | 9-case snapshot byte-identical ✓ |

Tests: [test/synthesis.test.ts](../../test/synthesis.test.ts) (9) — count-dist + cost constants, eligibility
(clean / influenced / fractured / corrupted), synthesise determinism + lifeforce + data-gap note, reroll
no-pool reject + poolSize keep-trying + abstract reject.

## Flags (for Eric to verify)

- **The league Synthesiser FUSION is gone** — not modelled (corrects the original Tier-2 assumption).
- **The synthesis implicit POOL is not in the repoe-fork export** — `P(desired)` needs the per-base implicit
  list sourced from poedb; the reroll uses a flagged uniform `1/poolSize` until then. **This is the main gap.**
- **Harvest synthesise cost (5000 Vivid + 1 Sacred)** and the **implicit-count distribution (75/19/6,
  datamined Harvest league)** are sourced but should be confirmed against the live 3.28 game.
- **Vivid Vulture** is a beast — not in the price feed → manual-price hook (like the eldritch Annulment Orb).

## Out of scope / next

**Memory strands + Hinekora's Lock** next (the resource-conditioned shape + the foresight / variance-killer).
No solver, no Track B, no automation.
