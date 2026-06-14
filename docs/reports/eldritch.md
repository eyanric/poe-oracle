# Report — Eldritch implicits (first Tier-1 coverage module)

**Date:** 2026-06-14 · **League:** Mirage (live) · **Status:** shipped, gates green (typecheck ✓ · lint ✓ · 249 tests ✓ · build ✓ · parity snapshot byte-identical).

First Tier-1 coverage module. **Reuses the resolved-weight machinery** (`effectiveWeight`) on the eldritch
implicit `generation_type`s — no scrape, no new weight derivation. Clean-room; analysis/information only;
manual-invoke. Confirmed PoE 1, stable since 3.17, current 3.28.

## Lead

- **Roll cost via the weight machinery.** `P(named implicit) = resolvedWeight / pool` over the
  `searing_exarch_implicit` / `eater_of_worlds_implicit` pools (base value-variant only). On **Iron Greaves
  @84**: Exarch *increased Movement Speed* P=**6.49%** → ~15.4 Exceptional Embers → **6283c (11.0 div)**;
  Eater *increased Life Regen rate* P=**6.85%** → ~14.6 Exceptional Ichors → **4541c (8.0 div)**. The same
  type-hit on a **Lesser** ember is ~**21c** (flagged: subset pool, can't reach top value → Orb-of-Conflict walk).
- **Dominance orbs = a side-targeted explicit op.** Eldritch **Exalt** = targeted ADD to the dominant side
  (Exarch⇒prefix, Eater⇒suffix), priced via the explicit pool's `slotShare`; Eldritch **Annul** = removal
  restricted to the dominant side (the deterministic "act on one side" lever). Validated: annul targets
  **prefix** when Exarch-dominant, **suffix** when Eater-dominant.
- **Eligibility enforced (eldritch ⊥ influence).** Influenced / corrupted / wrong-base-type items are
  **rejected**, not priced — and the rule is surfaced in the message. The `isInfluenced` primitive is shared
  so the **next module (influence)** reuses the exact exclusion.
- **Currencies priced live** (Embers/Ichors/Eldritch Exalt/Chaos, Orb of Conflict). **Eldritch Annulment Orb
  is not price-tracked** → manual-price hook + flag.
- **Orb-of-Conflict tier-walk = flagged representative EV** (≈2× tier gain), explicitly **not** simulated.
- **Parity snapshot byte-identical** — all additions are new methods; existing methods untouched.

## Data grounding (repoe-fork mods.json)

Eldritch implicits are **`generation_type`** values (not domains), in domain `item`:
`searing_exarch_implicit` (1998 mods) / `eater_of_worlds_implicit` (2070) — so the explicit prefix/suffix
index correctly skips them.

- **3 value-variants** per implicit (666 mods each): `base` / `…UniquePresence` / `…PinnaclePresence` — the
  altar-presence value scaling. **Only the `base` variant is the costing pool** (others would multi-count the
  same roll).
- **Eligibility tags:** an implicit rolls where its `spawn_weights` give weight>0 — observed on
  `gloves / boots / helmet / body_armour / amulet` (+ the unique amulet Eternal Struggle). Off-base ⇒ weight 0
  ⇒ excluded.
- **Value tiers** are gated by `no_tier_N_eldritch_implicit` spawn tags (N: **1=highest value … 6=lowest**),
  one gate per value-row. The **currency-tier → which-implicit-tiers** mapping is **not in this export** (it
  lives in the currency item defs we don't consume).

**Consequence (flagged):** the index models the **full pool = the top "Exceptional" currency**. Lower currency
tiers (Lesser/Greater/Grand) roll a SUBSET — cheaper per use, but cannot reach the top value tiers. Since the
type-set is the same across tiers, the practical play is **cheap ember to hit the type → Orb-of-Conflict to
walk the value tier up**; the report shows that path, with the subset caveat.

## What was modelled

[src/services/eldritch.ts](../../src/services/eldritch.ts):

1. **Eligibility** — `eldritchEligibility(state)` (base-type tag ∈ eligible set, not influenced, not corrupted)
   + the shared `isInfluenced(state)` primitive (influence module reuses it).
2. **Index** — `buildEldritchIndex(baseTags, side, mods)` (base variant, `effectiveWeight`>0), tier from the
   `no_tier_N` gate; `eldritchRollProbability(idx, {group|modId, tier?})`.
3. **CORE method `eldritch-implicit`** — side = desired slot (prefix=Exarch, suffix=Eater); P = weight/pool;
   expected Embers/Ichors × live price. `tier` picks the currency (default exceptional); `implicitTier` pins a
   value tier. Specific-named-implicit only (abstract → unsupported).
4. **`eldritch-exalt`** — targeted add on the dominant explicit side (reuses `buildSlotPool`/`slotShare`),
   priced with Eldritch Exalted Orb.
5. **`eldritch-annul`** — removal restricted to the dominant side; P(specific)=1/(affixes on that side) per orb;
   manual-price hook for the (untracked) Annulment Orb.
6. **`orbOfConflictEV(fromTier, toTier)`** — flagged representative first cut (≈2× tier gain).

Wired through the existing interface: `CRAFT_MODULES` registry + `CraftMethod`/`MethodSpec` kinds +
`resolveMethod` passthrough + the `calc_craft_cost` tool enum (with `eldritchTier` / `dominant` / `influence` /
`corrupted` / `affixes` inputs). `CraftSpec` gained `influence` / `corrupted` / `affixes` so eligibility +
annul see item context.

## Validation (`npm run validate:eldritch`, live)

| Check | Result |
|---|---|
| Named Exarch implicit (MovementVelocity) on Iron Greaves | P 6.49% → ~15.4 Exceptional Embers → **6283c (11.0 div)** ✓ |
| Named Eater implicit (LifeRegenerationRate) | P 6.85% → ~14.6 Exceptional Ichors → **4541c (8.0 div)** ✓ |
| Practical lower-tier path (Lesser ember, type-hit) | ~**21c** (flagged subset / Orb-of-Conflict walk) ✓ |
| Eligibility — influenced (shaper) | rejected: *"eldritch ⊥ influence: influenced items (shaper) cannot take eldritch implicits"* ✓ |
| Eligibility — corrupted | rejected ✓ |
| Eligibility — non-eligible base (ring) | rejected: *"roll only on gloves / boots / helmet / body_armour / amulet"* ✓ |
| Dominance annul — Exarch-dominant | acts on **prefix** (50% with 2 prefixes present) ✓ |
| Dominance annul — Eater-dominant | acts on **suffix** (100% with 1 suffix present) ✓ |
| Dominance exalt — Exarch-dominant | adds to **prefix**; on +max Life P=23% → 84c ✓ |
| Currencies priced live | Embers/Ichors/Eldritch Exalt/Chaos, Orb of Conflict ✓ — **Eldritch Annulment Orb not tracked** (manual price) |
| Orb-of-Conflict EV | present, **flagged representative** (tier 4→1 ≈ 6 orbs ≈ 8.1 div) ✓ |
| Parity | 9-case snapshot byte-identical ✓ |

Tests: [test/eldritch.test.ts](../../test/eldritch.test.ts) (17) — index eligibility/pool/tier,
`eldritchRollProbability` (group/modId/tier), eligibility (influence/corrupted/base + `isInfluenced`), modules
via `evaluateMethod` (named cost, abstract reject, influence reject, dominance side, exalt), Orb-of-Conflict EV.

## Caveats (flagged)

- **Full pool = Exceptional currency**; lower tiers roll a subset and the currency→implicit-tier map is not in
  the export. P is computed on the full pool; pricing at a lower tier is flagged as approximate.
- **Value-variant (Unique/Pinnacle presence) scaling excluded** — base values only (otherwise the same roll
  multi-counts).
- **Eldritch Annulment Orb is not price-tracked** by the feed — supply a manual price.
- **Orb-of-Conflict tier-walk is a flagged representative EV, not a simulation** (the paired downgrade + the
  true random-walk are deferred — a future refinement).
- Eldritch currency does **not** apply to influenced/unique/corrupted items (eligibility), nor to non-armour/
  amulet bases.

## Out of scope / next

Full Orb-of-Conflict tier-walk simulation deferred (flagged). **Influence is the next Tier-1 module** and
reuses the shared `isInfluenced` exclusion (eldritch ⊥ influence) placed here. No solver, no memory strands,
no Track B, no automation.
