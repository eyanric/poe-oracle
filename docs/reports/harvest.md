# Report — Harvest (first real method on the multi-arity interface)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, gates green (195 tests, parity intact).

Harvest is the first real crafting method built on the method-module interface, and its single-item
proving ground. No recombinators/memory strands, no solver, no Track B, no automation. Clean-room.

## ⚠ Lead — what the Harvest data reflects (the freshness-critical part)

Harvest is the most version-volatile method, and there is **no machine-readable export** (RePoE has no
harvest file — 404; poewiki/poedb 403 to automated fetch). So [data/harvestCrafts.ts](../../src/data/harvestCrafts.ts)
is a **curated dataset transcribed 2026-06-14 from current 3.28 sources** (Maxroll Harvest crafting
guide + poe.ninja lifeforce categories), with provenance + per-craft confidence flags baked in.

**Iteration it reflects (confirmed current 3.28):**
- Spend coloured **Lifeforce** (Vivid/Primal/Wild + Sacred) on recipes at the Sacred Grove / Horticrafting.
- The old **"reforge keeping prefixes/suffixes" crafts are GONE**; the forcing craft is now
  **"add a [tag] mod and remove a random other."**
- **Colour → mod-tag mapping (confirmed, Maxroll reforge table):** Wild = Fire/Attack/Life · Vivid =
  Cold/Physical/Chaos/Speed · Primal = Lightning/Defence/Caster/Critical.

**Confidence on amounts (the part to verify):**
- **Confirmed verbatim:** reforge fire/cold/lightning = 50, chaos = 100; augment (add+remove)
  Fire/Phys/Attack = 15000, Life/Defence/Caster/Critical = 17500, Speed = 20000, **+1 Sacred**.
- **Low-confidence (representative, flagged `costConfidence:'low'`):** reforge amounts for the other
  tags, and all **remove** amounts. The model surfaces a ⚠ note on any low-confidence craft.
- **Lifeforce is live-priceable** and confirmed: `Wild Crystallised Lifeforce` resolves on poe.watch at
  0.07c (Currency). Amounts × live price flow through the economy services.

## The module ([services/harvest.ts](../../src/services/harvest.ts), arity-1)

Implements the current craft shapes as a `CraftModule`, and is the proving ground that genuinely **reads
the item state**:
- **Reforge with [tag]** → reroll all, ≥1 of [tag] guaranteed; `P(target | tag) = share of the target in
  the tag sub-pool` → a `keep-trying` distribution (not deterministic).
- **Augment with [tag]** → add a [tag] mod to an open slot, **conditioned on blocking**: `outcomes` reads
  `state.blockedGroups` + occupied groups, so a pool blocked down to the desired mod is **deterministic**
  (`fixed` step, P=1); an open multi-group pool is a **distribution** (`keep-trying`). This is where
  Harvest + blocking combine.
- **Remove [tag]** → deterministic (`fixed`).
- **Change [tag]→[tag]** → not modelled (not confirmed present in 3.28; omitted rather than guessed).

**CRITICAL — ignores meta-locks (confirmed in code + test):** Harvest reforge does **not** respect
"prefixes/suffixes cannot be changed." The module reforges ignoring those metas, sets
`respectsLocks = false`, flags a **DANGER** note ("will WIPE the locked affixes"), and `toRiskSteps`
emits a `keep-trying` reforge — **never** a protected/`recoverable` slam. (`respectsLocks` is now an
explicit per-method flag on the contract; bench/slam = true.)

`cost` = lifeforce (colour + amount, + Sacred for forcing) priced live, with low-confidence flags +
provenance. Exposed in `calc_craft_cost` as `method: 'harvest'` (inputs: `harvestCraft`, `harvestTag`,
`blockedGroups`) dispatched through `evaluateMethod` — the interface, not bespoke code.

## Validation (LIVE — `npm run validate:harvest`)

| Check | Result |
|---|---|
| Lifeforce prices live | Wild Crystallised Lifeforce **0.07c** (Currency) ✅ |
| Reforge-with-tag | supported on real Vaal Regalia mods, tag-guaranteed ✅ |
| Augment reads blocked groups + deterministic when one group | ✅ |
| Ignores meta-locks | reforge on a `lockSuffixes` item proceeds, flagged DANGEROUS, `respectsLocks=false` ✅ |

**Blocked-vs-open augment contrast** — proven in [test/harvest.test.ts](../../test/harvest.test.ts): two
same-tag groups → open augment **P=50%** (distribution), block the other group → **P=100%, deterministic**
(`fixed` step), and `outcomes()` returns 1 vs 2 states accordingly.

**Honest note on the live contrast:** on Vaal Regalia (and the bases scanned), every single Harvest tag
resolves to **one** mod group under the pool model, so live augment is *already* deterministic there — a
correct result, just not a contrast. The open→blocked contrast needs ≥2 same-tag groups, which the
multi-group unit test demonstrates. Tag→pool matching is via mod `implicit_tags` (heuristic, flagged).

## Gate status
typecheck ✅ · lint ✅ (layering) · **195 tests** ✅ (+7 harvest; +2 data) · build ✅ ·
`validate:harvest` live ✅ · **parity snapshot byte-identical** (the v2 interface refactor still holds).

## Out of scope / next
No recombinators/memory strands (the two-item and resource-conditioned stress tests, next), no solver,
no Track B, no automation. Follow-up worth scheduling: confirm the low-confidence lifeforce amounts
(reforge non-core tags, all remove crafts) against the in-game Horticrafting station / a fresher source.
