# Report — real-export `parse_pob` validation

**Date:** 2026-06-16 · **Status:** 🟢 **first real export validated — 3 parser bugs found & fixed.** Corpus = 1 real build so far (Eric's); needs ~5–7 more for the full archetype spread. Gates green (typecheck ✓ · lint ✓ · 400 tests ✓ · build ✓).

The crux: a PoB export embeds PoB's **own computed stats** (`<PlayerStat stat value/>`). The validation
ground-truths our extracted Life/ES/DPS/resist against those — not "did it parse." **Validating one real
export immediately exposed three bugs the hand-built fixtures never could** — exactly the point of the
increment.

## Bugs found & fixed (the real export earned its keep)

The first real build (`0mLsHPwVEPfp`, Scion/Ascendant, CI/1-life) exposed:

| # | Bug | Cause | Fix (commit) |
|---|---|---|---|
| 1 | stat cross-check matched **0** stats (vacuously passed) | the harness regex assumed `stat="…" value="…"` order; real exports write **value-first** | `fix(pob-validate): order-independent PlayerStat cross-check` |
| 2 | every item parsed with **0 mods** | PoB's **export** item format ≠ in-game clipboard — no `--------` dividers; mods sit after an `Implicits: N` marker with `{crafted}`/`{fractured}`/`{range:…}` tags | `fix(pob): parse PoB-export item mods…` — `extractPobItemMods` (everything after `Implicits:`, tags stripped) → **0 → 239 mods** |
| 3 | every item `itemLevel = 0` | `Item Level: N` is inline (no `----`), so the clipboard parser missed it | same commit — inline `Item Level:` extraction → all 33 items now have ilvl |
| + | influence not surfaced | — | same commit — `influences` from the export's `X Item` lines (5 items labelled, e.g. Beast Jack = Shaper+Redeemer) |

All additive — the existing clipboard-format fixtures are untouched (the new path is gated on an `Implicits:`
line), so **parity holds, no snapshot churn**. New regression test (`pobRealExport.test.ts`) asserts the crux.

## ⚠ What I need from you (to finish the corpus)

**The fetch path works** — you supplied `pobb.in/0mLsHPwVEPfp` and `npm run validate:pob -- 0mLsHPwVEPfp`
fetched, validated, and (after the fixes) it's a committed regression fixture. I just need **~5–7 more
pobb.in ids** across the remaining archetypes (spell caster · attack bow/melee · minion · low-life/MoM ·
cluster/dense tree) to complete the spread. Send the ids; I run them through the same path.

Why I couldn't self-source the rest:

- **pobb.in is reachable** (200, no User-Agent block) and the **raw endpoint works**: `https://pobb.in/<id>/raw`
  returns the code (verified — invalid ids 404 with JSON, so valid ids return the export). The fetch path is
  ready in `validate-pob.mjs`.
- **But there is no way to DISCOVER build ids:** pobb.in has no public listing — homepage has no build links,
  `sitemap.xml` 404s, `api/builds` 500s. So I can fetch a build *if given its id*, but can't enumerate them.
- **poe.ninja builds isn't a usable source:** `getindexstate` returns empty, `getbuildoverview?overview=
  mirage-builds` / `settlers-builds` both 404, and even with a character it exposes JSON, not a PoB code (a
  PoB code requires PoB's own encoder).

Per the brief's fallback ("if pobb.in blocks… I'll supply raw codes") — **please supply ~6–8 pobb.in ids or
raw export codes** (your own build is the most authentic). Ideal spread: spell caster · attack (bow/melee) ·
minion · CI/ES · low-life/MoM · cluster-jewel/dense tree · crafted-gear-heavy. Then:
`npm run validate:pob -- <id> <id> …` fetches + validates + emits the per-build table, and I commit the raw
exports as regression fixtures with a stat-cross-check test each.

## The harness (built + ready)

- **[scripts/validate-pob.mjs](../../scripts/validate-pob.mjs)** (`npm run validate:pob -- <pobb.in-id>…`):
  fetches each build's raw export (browser UA + polite delay, cached to `test/fixtures/real/`), decodes, parses,
  and runs the **stat ground-truth cross-check**, plus completeness (items/mods/skill-groups/tree counts). With
  no args it validates every committed fixture.
- **The cross-check (`statCrossCheck`)** independently regex-extracts **every** `<PlayerStat>` from the decoded
  XML and asserts our parser surfaces each one with the **same value** — catching any XML-parser fidelity bug
  (a stat dropped or misread) that a real export's shape might trigger. This is the regression net: a test per
  build asserting `parsed.stats[k] == PoB's PlayerStat[k]`.

## Proof on existing fixtures (harness works)

| Build | parse | identity | stat X-check | completeness |
|---|---|---|---|---|
| `pob-endgame.txt` | ✓ | Witch/Necromancer L95 · Raise Spectre | **✓ 8/8 PlayerStats == PoB** (Life 5200, ES 1480, DPS 3.55M, res 75/76/75) | items 3 (8 mods) · 2 skill groups · tree 109 |
| `pob-leveling.txt` | ✓ | Witch L42 · Freezing Pulse | **✓ 7/7 PlayerStats == PoB** (Life 1240, ES 60, DPS 8500) | items 2 (4 mods) · 2 skill groups · tree 25 |

Both hand-built fixtures cross-check clean — the logic is sound. **These are synthetic, so they don't exercise
the real-world shapes the brief targets** (CDATA, nested SkillSets/ItemSets, dense trees, crafted/influenced
mod stacks, 1-life CI, FullDPS keys). That's exactly what the real corpus is for.

## Per-build validation table

| Build | archetype | parse | identity | stat X-check | items/mods | tree | notes |
|---|---|---|---|---|---|---|---|
| `0mLsHPwVEPfp` | Scion CI/1-life, Smite of Divine Judgement | ✓ | Scion/Ascendant L100 ✓ | **✓ 94/94 PlayerStats == PoB** (Life 1, ES 9916, Armour 1.05M, DPS 112M) | ✓ 33 items, 239 mods, 5 influenced | ✓ 136 nodes | exposed bugs #1–3 (now fixed); FullDPS=0 on this build (PoB reports TotalDPS/CombinedDPS — surfaced) |
| _spell caster_ | — | ⏳ awaiting code | | | | | |
| _attack (bow/melee)_ | — | ⏳ | | | | | |
| _minion_ | — | ⏳ | | | | | |
| _low-life / MoM_ | — | ⏳ | | | | | |
| _cluster / dense tree_ | — | ⏳ | | | | | |
| _crafted-gear-heavy_ | — | ⏳ | | | | | |

_(0mLsHPwVEPfp already covers the CI/ES + crafted-gear shapes — 33 items, crafted/influenced mods.)_

## Notes / next

- Flag-don't-invent: I did **not** fabricate "real" exports to fill the corpus — synthetic fixtures can't
  validate real-world shapes, so that would defeat the increment. The corpus must be genuinely real.
- The harness is additive (no parser change yet) → parity holds. Fixes (if the real corpus exposes bugs) come
  next, each a cited correction.
- After the corpus validates: any deep extraction issue (e.g. an unusual skill's DPS) is a flagged follow-up,
  not crammed in.
