# RePoE Data-Source Validation (Phase 0)

**Gate:** crafting-EV rides entirely on mod spawn weights. Bad data → confidently-wrong EV,
which is worse than no tool. This validates the data source is **live**, **current-patch**, and
**numerically sound** before any of it is ported into `@poe-core` (Phase 1).

**Harness:** [`packages/poe-mcp/scripts/validate-repoe.mjs`](../packages/poe-mcp/scripts/validate-repoe.mjs)
— `node packages/poe-mcp/scripts/validate-repoe.mjs` (exits non-zero on any failure).
**Last run:** 2026-06-13 — **20/20 checks PASS**.

---

## Data source

| | |
|---|---|
| **Source** | `https://repoe-fork.github.io/<file>.min.json` — the **maintained** RePoE fork (`repoe-fork/repoe`), hosted JSON exports on GitHub Pages. |
| **Why this one** | Legacy `brather1ng/RePoE` is a dead end — it needs a custom PyPoE fork to regenerate. The fork is actively maintained (repo commits within the last week; data regenerated **today**). |
| **License posture** | We consume **DATA, not code** (same as poe.ninja / poedb / PoB). The weight math is reimplemented clean-room. No GPL source is imported. |
| **Files used** | `mods`, `base_items`, `item_classes`, `stat_translations`, `essences`, `fossils`, `crafting_bench_options` (`.min.json`). |

## Patch currency (freshness)

- **Current PoE 1 patch: 3.28 "Mirage"** (launched 2026-03-06, ends ~2026-07-13; **3.29 launches 2026-07-24** — the target league).
- All four core files returned HTTP 200 with `Last-Modified: Sat, 13 Jun 2026 11:34:5x GMT` — **regenerated today**, well after league start.
- Cross-checks: the fork repo (`repoe-fork/repoe`) shows maintenance commits on 2026-06-07; the live economy resolver independently resolves the current league to **Mirage**. The data, the repo, and the live game agree.
- No `version.json` is published, so freshness is asserted via `Last-Modified ≥ league start` plus the cross-checks above (the harness enforces the date floor).

## Dataset sizes (this run)

| Dataset | Count | Note |
|---|---|---|
| mods | 39,292 | full mod table |
| essences | 106 | `item_class → mod_id` maps present |
| fossils | **445 entries / 26 distinct names** | ⚠ keyed by metadata path; only **26** are real player fossils (440 carry mod/weight effects). **Phase 1 must dedupe by name.** |
| Vaal Regalia mod pool @ ilvl 84 | 60 prefixes / 61 suffixes | minimal weight slice |

---

## Validation cases (all PASS)

### Case A — pool sanity & weight normalization (Vaal Regalia, ilvl 84)
- Prefix/suffix pools non-empty (60 / 61).
- **Per-slot probabilities sum to exactly 1.0** (Σ = 1.000000000000 for both prefix and suffix) — no double-count, no NaN, weights normalize.
- Increased Life prefix present at **20.34%** of total prefix-slot weight — believable (life is among the highest-weight prefixes; all top-5 prefix slots are `IncreasedLife:1000`).

### Case B — ilvl gating + equal-weight tier odds (alt-spam, Increased Life)
- **ilvl gating works:** 12 life tiers available at ilvl 84 vs 13 at ilvl 100 (T1 `IncreasedLife12` requires ilvl 86, correctly excluded at 84). This integer delta is a real gating check, not a tautology.
- All available tiers share weight 1000 ⇒ **P(specific tier | life rolled) = 1/12 = 8.33%** at ilvl 84, exactly — matches Craft-of-Exile's equal-weight tier behaviour.
- Essence-only life tiers (`IncreasedLifeEssence*`, weight 0) are **excluded** from the normal pool.

### Case C — essence-slam determinism (Deafening Essence of Greed)
- Essence exists; its **Body Armour** map forces `IncreasedLife11` (a real prefix, group `IncreasedLife`, required level 81).
- The forced mod is spawnable on the base (weight 1000) ⇒ **P = 1** by mechanic. Essence-slam EV is data-backed: one guaranteed mod + a random rare for the rest.

---

## Honest limits of this validation (and what Phase 1/2 must add)

- **No Craft-of-Exile numeric scrape.** CoE is JS-rendered and not reliably fetchable as text. Case B's 1/N is validated against the *mechanic* (equal weights) and known community facts (13 life tiers; essence-of-greed → life), not a screen-scraped CoE figure. The full **EV-vs-live-trade-price** cross-check is deferred to **Phase 2**, where pricing enters and "craft vs buy" can be checked end-to-end.
- **The harness uses a minimal weight slice** (domain match, first-matching `spawn_weights` tag, `generation_weights` multiplier, `required_level` gate, `is_essence_only` exclusion). Phase 1 must additionally handle, **with tests**:
  - mod-**group exclusivity** across the whole item (can't roll two mods from one group),
  - prefix/suffix **slot caps** (3/3 on rares) and magic-item mod-count weighting,
  - **meta-mods** ("cannot roll X", multimod) reweighting the pool,
  - **influence / fractured / essence / fossil** weighting vs plain alch/chaos,
  - **fossils dedupe** (445 metadata entries → 26 real fossils).

**Verdict:** the data source is live, current (3.28 Mirage, regenerated today), structurally complete, and numerically consistent for the weight model. **Cleared to proceed to Phase 1** (RePoE port into `@poe-core`).
