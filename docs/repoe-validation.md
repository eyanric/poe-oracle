# RePoE Data-Source Validation (Phase 0)

**Gate:** crafting-EV rides entirely on mod spawn weights. Bad data → confidently-wrong EV,
which is worse than no tool. This validates the data source is **live**, **current-patch**, and
**numerically sound** before the full RePoE port + `calc_craft_cost` (Track A).

**Data-layer loader:** [`src/data/repoe.ts`](../src/data/repoe.ts) — typed getters on the `fetchJson`
cache, pointed at `repoe-fork.github.io`. The two harnesses below run on top of it.

**Harnesses:**
- [`scripts/validate-repoe.mjs`](../scripts/validate-repoe.mjs) — `npm run validate:repoe`: structure,
  freshness, weight normalization, ilvl gating, essence determinism (**20/20 PASS**).
- [`scripts/ev-sanity.mjs`](../scripts/ev-sanity.mjs) — `npm run validate:ev`: **live** EV cross-check
  composing the loader + economy services (orbs/finished-item priced via poe.watch/poe.ninja).

**Last run:** 2026-06-14 — patch **3.28 Mirage**, all checks PASS.

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

## EV sanity (live, Phase 1) — `npm run validate:ev`

Composes the `data/repoe` loader + the economy services to cross-check first-pass
expected-attempts/cost. Run 2026-06-14, league Mirage — all PASS:

- **Live price leg:** Divine 526c · Orb of Alteration 0.08c · Regal 0.08c · Headhunter 4747c (≈9 div)
  all price live — the economy data the cost model depends on is working end-to-end.
- **Case 1 — essence slam (deterministic):** Deafening Essence of Greed forces `IncreasedLife11`
  ⇒ expected attempts = **1** (CoE oracle: a forced mod is 100%); EV = 1 × 3.4c = **3.4c**.
- **Case 2 — alt→regal, Increased Life prefix (Vaal Regalia, ilvl 84):** life = **20.3%** of prefix
  weight ⇒ **~4.9 alts** to roll it as a prefix; EV ≈ 4.9×0.08c + 0.1c ≈ **0.5c**. Believable —
  life is a common, high-weight prefix. *First-pass: ignores magic 1-vs-2-mod weighting.*

⚠ **Orb micro-price caveat:** Orb of Alteration and Regal both report 0.08c (equal) — in a
divine-dominated economy chaos is a micro-unit, but equal values hint at thin/low-confidence orb
data. `calc_craft_cost` (Track A) must consume the `lowConfidence` flags and prefer divine-denominated
sums for any spend-worthy number.

---

## Honest limits of this validation (and what Track A must add)

- **No Craft-of-Exile numeric scrape.** CoE is JS-rendered and not reliably fetchable as text. Case B's 1/N and Case 1's 100% are validated against the *mechanic* (equal weights / forced mod) and known community facts (13 life tiers; essence-of-greed → life), plus the live EV harness above — not a screen-scraped CoE figure.
- **The harness uses a minimal weight slice** (domain match, first-matching `spawn_weights` tag, `generation_weights` multiplier, `required_level` gate, `is_essence_only` exclusion). Track A's full port must additionally handle, **with tests**:
  - mod-**group exclusivity** across the whole item (can't roll two mods from one group),
  - prefix/suffix **slot caps** (3/3 on rares) and magic-item mod-count weighting,
  - **meta-mods** ("cannot roll X", multimod) reweighting the pool,
  - **influence / fractured / essence / fossil** weighting vs plain alch/chaos,
  - **fossils dedupe** (445 metadata entries → 26 real fossils).

**Verdict:** the data source is live, current (3.28 Mirage, exports regenerated 2026-06-13), structurally complete, numerically consistent for the weight model, and the live EV pipeline produces believable first-pass numbers. **Cleared to proceed to Track A** (full RePoE port + `calc_craft_cost`) — pending the user's go.
