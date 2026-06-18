# Report — MCP surface self-test (live acceptance pass)

**Date:** 2026-06-17 · **League:** Mirage (live) · **Method:** spawned the built `poe-oracle` server (`node dist/index.js`) over stdio and called every tool **as an MCP client** with real inputs. Read-only; no code changes.

`tools/list` → **14 tools** ✓ (`appraise · calc_craft_cost · calc_recombine · currency_overview · estimate_build_cost · get_patch_notes · league_start_plan_contract · parse_pob · passive_tree · price_check · price_check_item · resolve_target · solve_craft · watch`).

## 1. Rung health summary

| Rung | Status | Notes |
|---|---|---|
| **Rung 1 — static data** (repoe-fork, tree, all parsing/weights/solver) | 🟢 **GREEN** | parse_pob, passive_tree, resolve_target, calc_craft_cost, price_check_item parse, solve_craft, calc_recombine, get_patch_notes, contract — all correct |
| **Rung 2 — economy** (poe.watch default) | 🟡 **GREEN w/ 1 defect** | standard currency/uniques fine (Divine 560c, Tabula 7.83c); **variant unique JEWELS mispriced** → the one real bug |
| **Rung 3 — trade** (GGG API) | 🟢 **GREEN** | better than expected w/o `POESESSID`: appraise live section present, solve_craft buy-side present, watch 2 rows, price_check live. (price_check_item returned no listings for the synthetic rare — expected.) |
| **Track B** | 🟢 **GREEN** | get_patch_notes 33 sections / currency 36 (live-HTML hardening holds); contract caveat present |

Active economy provider: **poe.watch** (default). `POESESSID`: **not set** (trade still functioned via public search). Auto-resolve (no `league`) → **Mirage** ✓.

## 2. Per-tool results (actual observed values)

| # | tool | rung | inputs | verdict | observed | note |
|---|---|---|---|---|---|---|
| 1 | `parse_pob` | 1 | `pobb.in/0mLsHPwVEPfp` | **PASS** | Scion/Ascendant L100 · items 33, maxMods 14, Life 1, ES 9916, nodes 136, keystones 5, notables 11 | CI build (Life 1 correct); mods populated |
| 2 | `passive_tree:stats` | 1 | first 15 of `trees[0].nodeIds` | **PASS** | statKeys 8, unresolved 6 | unresolved 6/15 a touch high but resolves real stats |
| 2 | `passive_tree:lookup` | 1 | `node 7388` | **PASS** | → "Intelligence" (normal) | |
| 2 | `passive_tree:path` | 1 | two allocated ids | **PASS** | distance 16, path length 17 | finite path |
| 3 | `resolve_target` (Life) | 1 | `"increased maximum Life"`, Vaal Regalia | **PASS\*** | 11 cands [veiled,influence,synthImplicit], **no explicit** | *phrasing artifact — see note A; `"maximum Life"` → 17 explicit* |
| 3 | `resolve_target` (ES) | 1 | `"increased maximum Energy Shield"` | **PASS** | 6 cands [eldritch-implicit] | `"maximum Energy Shield"` → 19 explicit |
| 4 | `calc_craft_cost` | 1 | alt-regal, ES group | **PASS\*** | with real group `IncreasedLife`: supported ✓, EA 6.21, p 0.161, **2.74c** | *harness fed a bad group via test-3 chain; tool is correct (note A)* |
| 5 | `currency_overview` | 2 | Mirage | **PASS** | 20 currencies, **Divine 560c** | |
| 6 | `price_check` (Divine) | 2 | Divine Orb | **PASS** | Divine ≈ 560c | |
| 6 | `price_check` (Headhunter) | 2 | Headhunter | **PASS** | unique match present (~39 div) | |
| 7 | `appraise` | 3 | Divine Orb | **PASS** | aggregator rows ✓, live section ✓ | |
| 8 | `price_check_item` | 1 | the Rare Vaal Regalia block | **PASS** | parse: Rare · Vaal Regalia · ilvl 86 · explicits 7 (≥4 ✓); price n/a | parse is rung-1 PASS; no-listings price = rung-3 expected |
| 9 | `watch` | 3 | Divine, Chaos | **PASS** | 2 rows | |
| 10 | `solve_craft` (solve) | 1 | `query:"increased maximum Energy Shield"` | **PASS** | kind **solved**, 1 plan, **buySide present**, verdict buy-likely-cheaper | |
| 10 | `solve_craft` (disambig) | 1 | multi-identity query | **PASS** | kind **disambiguation** | |
| 10 | `solve_craft` (abstract) | 1 | `{label:"any prefix"}` | **PASS** | kind **unresolved** | guard holds |
| 11 | `calc_recombine` (Mirage) | 1 | two rings | **PASS** | **supported:false** + league reason | gate holds (no leak) |
| 11 | `calc_recombine` (Settlers) | 1 | two rings | **PASS** | supported ✓, pTarget 0.81, brickProb 0.19 | math sane |
| 12 | `get_patch_notes` | 1 | `"3.28"` | **PASS** | **sections 33, currency 36**, skills 54, uniques 22, mechanics 274 | hardening holds (not >100, currency>0) |
| 13 | `estimate_build_cost` (pob) | 2 | `pobb.in/0mLsHPwVEPfp` | **🔴 BUG** | 33 pieces, tier aspirational, **total 14,790 div** | mispriced variant uniques — see Bug 1 |
| 13 | `estimate_build_cost` (items) | 2 | Tabula Rasa | **PASS** | Tabula **7.83c**, tier starter | non-variant unique prices fine |
| 14 | `league_start_plan_contract` | 1 | Mirage 3.28.0 | **PASS** | skeleton + 1 caveat, **predictive caveat present** | |
| 15 | auto-resolve | 2 | `currency_overview` no league | **PASS** | resolved → **Mirage** | |

## 3. Bug list (genuine — candidates for a follow-up fix increment)

**Bug 1 — `estimate_build_cost` mis-prices variant unique JEWELS (substantively wrong output).**
On `pobb.in/0mLsHPwVEPfp` the total came to **14,790 divine**, entirely driven by absurd per-piece prices for
**variant uniques**:

| piece | reported | reality |
|---|---|---|
| Screams of the Desiccated | **6,202 div** (3.43M chaos) | a few div |
| Voices (×3) | **2,471 div each** (1.37M chaos) | tens of div |
| Thread of Hope | **1,216 div** | a few div |
| Forbidden Flesh / Flame | 93 / 28 div | varies by notable |

Root hypothesis (rung 2): these uniques have **many priced variants** (Forbidden Flame/Flesh per ascendancy
notable; Voices by passive count; Screams of the Desiccated). The build-cost unique matcher resolves by name and
appears to grab an **extreme-priced variant** (or a low-supply outlier) instead of the right/median one — so the
total is ~100× too high. Non-variant uniques price correctly (Tabula 7.83c, Headhunter, Mageblood). **Fix
direction:** variant-aware matching (pick the build's actual variant, or the median/lowest sane listing) +
low-confidence flag when a unique has divergent variants. Not a trade-rung issue.

_(No other genuine bugs. The two harness-flagged "BUG"s were verified NOT defects — see Note A.)_

## 4. Degraded / env / notes (NOT bugs — keep off the fix queue)

- **Note A — `resolve_target` literal phrasing (not a bug).** `"increased maximum Life"` returned only
  veiled/influence/synth candidates (no flat explicit) because body-armour life is `"+# to maximum Life"` — the
  literal substring `"increased maximum life"` isn't in that text. Verified: `"maximum Life"` → **17 explicit**,
  `"maximum Energy Shield"` → 19, `"Energy Shield"` → 38; and `calc_craft_cost` with the real `IncreasedLife`
  group works (2.74c). So the resolver + craft-cost are correct; the test-3 phrasing is a poor query for flat
  stats. *Optional polish (low priority): stat-text normalization/stemming so "increased maximum X" also surfaces
  the flat "+to maximum X" explicit.*
- **`price_check_item` price = n/a (DEGRADED-expected).** The synthetic test rare has no live listings — parse
  (rung-1) passed; price (rung-3) legitimately empty.
- **Trade rung healthier than expected** without `POESESSID` — public search served appraise/solve buy-side/watch.
  Setting `POESESSID` would add the authenticated live sample to `appraise` and tighten verdicts.
- **`calc_recombine` Settlers economy 400s** — poe.watch has no "Settlers" economy league (it's not live); the
  recombine *math* still returned valid probabilities (it doesn't need the economy). Expected, not a defect.

## Bottom line

**14/14 tools respond with the correct *kind* of answer** against live Mirage data — rung 1 and Track B fully
green, rung 3 (trade) green even without a session, gates the unit tests can't reach (MCP boundary, real inputs)
all held, including the parse_pob mods and the 33-section patch parse that were hollow before. **One genuine
bug:** `estimate_build_cost` variant-unique-jewel pricing (→ a ~100× inflated build total). One optional resolver
polish. Everything else passed.
