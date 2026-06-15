# Report — Harvest v2 (league gating + Crystallised Rancour + Foulborn)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, gates green (198 tests, parity intact).

> **⚠ CORRECTED 2026-06-15 (see [lock-matrix-fix.md](lock-matrix-fix.md)):** statements below that "Harvest
> reforge ignores meta-locks (`respectsLocks=false`, DANGER)" are WRONG — Harvest reforge **RESPECTS** "cannot
> be changed" in 3.28 (rerolls only the unlocked side). `respectsLocks` is now `true`; the DANGER note is gone.

Refines Harvest with the 3.28 Mirage additions. The **durable win is league-availability gating**
(reusable for every league-specific mechanic); Rancour is its first real test. No recombinators/memory
strands, no solver, no Track B, no automation. Clean-room.

## Confirmed vs flagged (lead)

| Item | Status |
|---|---|
| **League gating** | ✅ built + proven: Rancour excluded in a non-Mirage league with a clear flag, **core methods unaffected, parity byte-identical** |
| **Crystallised Rancour = Mirage-only** | ✅ confirmed (drops from Corpse-Grown monsters in Harvest-in-Mirage); prices **live at 14.2c** |
| **Rancour reforges = Minion / Attribute / Mana** | ✅ confirmed (current Mirage sources) |
| **Rancour amounts** (Minion 200 Primal+3, Attribute 200 Vivid+2, Mana 200 Primal+2) | ⚠ **low-confidence** — single community source (u4n), unverified vs in-game |
| **Foulborn** | ✅ identified — it is a **Mirage unique-variant**, NOT a Harvest mod source → deliberately **not** modeled in craft pools (would be wrong); sent to backlog |
| **Phase-4 re-source of old low-confidence amounts** | ⚠ blocked — authoritative sources (poewiki/poedb) still 403 to automated fetch; flagged amounts stay flagged |

## Phase 1 — League-availability gating (the reusable piece)

- `CraftDataContext.currentLeague` + `CraftModule.leagues?` (omitted ⇒ core/all-leagues) + a pure
  `isLeagueActive(leagues, current)` helper ([craftModule.ts](../../src/services/craftModule.ts)).
- **Module-level** gate in `evaluateMethod` (a whole method league-restricted → clear "league-specific,
  not active" result). **Per-craft** gate inside the Harvest module via `ctx.currentLeague` (Rancour
  crafts carry `league: 'Mirage'`). `calc_craft_cost` passes the resolved league through.
- Existing methods declare no `leagues` ⇒ **no behaviour change** — the parity snapshot is byte-identical.
- Unknown league ⇒ not gated (can't filter without a resolved league). Tested in
  [test/harvest.test.ts](../../test/harvest.test.ts).

## Phase 2 — Crystallised Rancour (Mirage-only)

- `data/harvestCrafts.ts`: `Crystallised Rancour` as a Mirage lifeforce + Rancour reforges
  (minion/attribute/mana) carrying `league: 'Mirage'`, the regular-lifeforce colour+amount, and the
  Rancour count — all `costConfidence: 'low'` (single community source).
- The module models them as **reforge-with-tag** → `keep-trying` distributions, **still ignoring
  meta-locks** (`respectsLocks = false`, DANGER note) like base Harvest.
- **Multi-currency cost** handled cleanly: a new `extra` field on plan steps folds Rancour (and augment's
  Sacred) into the *same* per-use cost, so `costPerAttempt = 200×lifeforce + N×Rancour` is exact (no
  double-counting). Priced live; Rancour resolves at 14.2c.

## Phase 3 — Foulborn (researched, deliberately not modeled)

Foulborn is **not** a Harvest/Rancour craftable modifier. It is a **3.28 Mirage unique-item variant**: a
"Foulborn `<Unique>`" has one or more of its modifiers replaced by *mutated* ("Foulborn") modifiers
correlated with the original, dropped via Betrayal / Corpse content (e.g. Foulborn Ghostwrithe, Foulborn
Doedre's Scorn). Modeling it in reforge/augment mod-pools would be wrong, so it is **excluded from the
craft model** and recorded in [docs/backlog.md](../backlog.md) as exactly the "specific unique variant
required" case of the deferred unique-pricing feature (tag Mirage-only). Nothing about Foulborn behaviour
was invented.

## Phase 4 — Re-source low-confidence amounts

Attempted to promote the previously-flagged amounts (reforge non-core tags, all remove crafts). The
authoritative sources (poewiki/poedb) remain **403 to automated fetch**, and only secondary content
guides are reachable — not a strong enough basis to promote out of low-confidence. So they **stay
flagged**, and the new Rancour amounts are likewise flagged. The model surfaces a ⚠ note on every
low-confidence craft. (Follow-up needs in-game Horticrafting values or a fetchable authoritative source.)

## Validation (LIVE — `npm run validate:harvest`)

- Lifeforce + **Crystallised Rancour price live** (Wild 0.07c; Rancour 14.2c, Currency).
- **Rancour attribute reforge ACTIVE in Mirage** (target Intelligence, **+2 Rancour** folded into the
  step cost); **EXCLUDED in a simulated Standard league** with "league-specific (Mirage…) not active"; a
  **core life reforge stays active** in Standard.
- Ignores meta-locks honoured (reforge on a locked item flagged DANGEROUS, `respectsLocks=false`).
- Blocked-vs-open augment contrast remains covered by the multi-group unit test.

## Gate status
typecheck ✅ · lint ✅ (layering) · **198 tests** ✅ (+3 gating/Rancour) · build ✅ ·
`validate:harvest` live ✅ · **parity snapshot byte-identical** (interface refactor intact).

## Out of scope / next
Recombinators (the two-item stress test) next. No memory strands yet, no solver, no Track B, no
automation. Carried follow-ups: confirm low-confidence lifeforce/Rancour amounts vs in-game;
Foulborn folded into the unique-by-variant pricing backlog item.
