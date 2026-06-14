# Track A — Full RePoE weight model + `calc_craft_cost` (Phase 2 + 3)

Builds on the Phase 0/1 data-source validation ([`repoe-validation.md`](./repoe-validation.md)).
Phase 1 shipped a *minimal* weight slice and an honest list of gaps. Track A closes those
gaps with a clean-room weight model, an expected-attempts/EV layer, and the `calc_craft_cost`
MCP tool — each element unit-tested, then validated live end-to-end.

**Standing constraints honoured:** analysis-only / manual-invoke (the tool informs, never acts);
clean-room over RePoE **data** exports (no GPL code, no PoB source); layered `tools/ → services/ → data/`
(ESLint rule green); small verified steps (typecheck + lint + 80 tests green).

---

## Phase 2 — the weight model (`services/craftingModel.ts`, `services/craftMethods.ts`)

The eight mechanics Phase 1 left open, each a pure function with a unit test
(`test/craftingModel.test.ts`, `test/craftMethods.test.ts` — 25 tests):

| # | Element | Where | How it's modelled |
|---|---|---|---|
| 1 | **Mod-group exclusivity** | `buildSlotPool` (`usedGroups`) | once a group is occupied, every tier in that group is dropped from the remaining pool. |
| 2 | **Prefix/suffix slot caps** | `SLOT_CAPS` | rare 3/3, magic 1/1, normal 0/0. |
| 3 | **ilvl gating** | `buildSlotPool` | mods with `required_level > ilvl` excluded (tested: 12 life tiers @84 vs 13 @86). |
| 4 | **Tag-based weighting** | `effectiveWeight` | first matching `spawn_weights` tag × first matching `generation_weights` **percent** multiplier — the *specific* base's tags, not a generic pool. |
| 5 | **Magic mod-count distribution** | `magicOccupancy` | a magic item has 1–2 affixes; a 2-affix item is exactly 1 prefix + 1 suffix, a 1-affix item splits prefix/suffix by pool weight. This yields `P(prefix present) < 1`, which is the **fix for Phase 1's "every alt yields a prefix" simplification**. |
| 6 | **Meta-mods** | `MetaMods` + `buildSlotPool` | "cannot roll attack/caster" drop mods tagged `attack`/`caster` (via `implicit_tags`); "prefixes/suffixes cannot be changed" lock the slot empty. |
| 7 | **Essence forcing** | `craftMethods.essence` | the essence guarantees its mod (deterministic, P=1, 1 attempt). |
| 8 | **Fossil dedupe + reweighting** | `dedupeFossilsByName`, `fossilWeightMultiplier` | 445 metadata entries → 25 distinct fossils; `forbidden_tags`/`allowed_tags` gate the pool, `positive`/`negative_mod_weights` apply percent multipliers (1000 → ×10, 0 → removed); multiple fossils compound. |

**Expected-attempts math** (`craftMethods.ts`): single-mod targets are geometric (`1/P(hit)`).
Compound targets are **not** a naive product — the two-mod alt→regal leg uses the magic
**P(2-affix)** factor (`alt until both present, then regal`). Targets the model cannot yet
sequence are returned `supported: false` with a reason (e.g. multi-mod rare reroll needs a full
without-replacement affix simulation) rather than guessed.

## Phase 3 — `calc_craft_cost` (`services/craftCost.ts`, `tools/craft.ts`)

Pipeline: weight model → expected attempts → per-step consumable usage → **live**-priced via the
economy services → total expected cost (chaos **and** divine) + a craft-vs-buy verdict.

**Pricing discipline (Phase 1 caveat carried through):** every consumable carries its
`lowConfidence` flag; thin chaos micro-prices (alt/regal in a divine economy) and the unmodelled
magic/rare affix-count constants **flag the whole estimate low-confidence**, the output prefers
divine-denominated sums, and the league + date are stamped. No 0.08c-style false precision.

---

## Live end-to-end validation — `npm run validate:craft`

Run **2026-06-14**, league **Mirage (3.28)**, prices via poe.watch. All checks PASS.

### Craft 1 — essence slam (deterministic)
`Deafening Essence of Greed → Vaal Regalia (ilvl 84)`
- Forced mod `IncreasedLife11` ⇒ **expected attempts = 1** (P=1 by mechanic).
- Total = 1 essence = **3.4c (0.006 div)**, priced live; **not** low-confidence (deterministic + indexed essence).

### Craft 2 — alt → regal, Increased Life prefix (the Phase 1 leg, now magic-aware)
`alt-regal, Increased Life prefix → Vaal Regalia (ilvl 84)`
- Phase 1 (naive): life = 20.3% of prefix weight ⇒ "~4.9 alts", assuming **every** alt gives a prefix.
- Track A: `P(life)/alt = P(prefix present ≈75.8%) × share 20.3% = 15.38%` ⇒ **~6.5 alts** + 1 regal.
- The correction is exactly the spec's ask — *model the chance an alt yields no prefix at all*; expected attempts rose 4.9 → 6.5 because occupancy < 1.
- Total ≈ **3.1c (≈0.006 div)**; **flagged low-confidence** (magic affix-count constant + thin orb prices).

### Craft 3 — craft-vs-buy verdict wiring
- Finished item priced live (Headhunter 4747c ≈ 8.4 div); verdict resolves to **CRAFT/BUY** with a chaos+divine margin, not `unknown`.
- ⚠ This validates the **verdict mechanism**. A *meaningful* craft-vs-buy for a **rare** needs the
  finished rare priced via the live **trade** service (`appraise`) — aggregator snapshots index
  uniques/currency/essences, not crafted rares. Routing finished-rare pricing through trade is the
  one carried-forward limitation (see below).

### Craft 4 — unsupported guardrail
- Multi-mod chaos-spam is correctly returned **`supported: false`** ("needs full without-replacement
  affix simulation") — the model marks what it can't sequence instead of inventing a number.

---

## Coverage: modelled vs still-stubbed

**Modelled + tested:** group exclusivity · slot caps · ilvl gating · tag/generation weighting ·
magic mod-count occupancy · meta-mods (cannot-roll attack/caster, prefix/suffix locks) · essence
forcing · fossil dedupe + tag reweighting · single-mod geometric EV · two-mod alt→regal sequence ·
single-mod chaos/fossil rare reroll · live consumable pricing · craft-vs-buy verdict.

**Stubbed / flagged (honest limits):**
- **Magic & rare affix-count constants** are not in RePoE (hardcoded game values). The magic constant
  uses a community estimate (`MAGIC_TWO_AFFIX_PROB = 0.5`); rare reroll uses an equal-weight {4,5,6}
  affix estimate. **Every EV that depends on them is flagged low-confidence** — divine sums are the
  trustworthy figure.
- **Compound rare targets** (≥2 mods via chaos/fossil) — unsupported (needs without-replacement /
  group-removal simulation), returned as such.
- **Bench-craft / multimod / annul finishing legs** — modelled in the pool (meta-mods) but not yet
  sequenced as cost legs; targets requiring them are marked unsupported.
- **Finished-rare buy price** routes through aggregator snapshots only; real rare comparisons need the
  live trade service. Verdict logic is in place and validated; the rare-pricing hook is future work.

**Verdict:** Phase 2 weight model and Phase 3 `calc_craft_cost` are implemented, unit-tested (80
tests green: 25 new model/EV + cost tests), and validated live. Expected-attempts numbers are
data-backed and the Phase 1 alt→regal simplification is fixed; confidence is capped (not overstated)
wherever an unmodelled constant or thin price is in play.
