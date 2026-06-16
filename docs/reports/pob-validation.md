# Report — real-export `parse_pob` validation

**Date:** 2026-06-16 · **Status:** 🟢 **6-build real corpus validated — 5 parser bugs found & fixed.** All 6 cross-check clean (every PoB `<PlayerStat>` == our value). Gates green (typecheck ✓ · lint ✓ · 418 tests ✓ · build ✓).

The crux: a PoB export embeds PoB's **own computed stats** (`<PlayerStat stat value/>`). The validation
ground-truths our extracted Life/ES/DPS/resist against those — not "did it parse." **Validating one real
export immediately exposed three bugs the hand-built fixtures never could** — exactly the point of the
increment.

## Bugs found & fixed (the real corpus earned its keep)

Five parser/harness bugs the hand-built fixtures could never expose, each found by a real build:

| # | Bug | Cause | Build that exposed it / fix |
|---|---|---|---|
| 1 | stat cross-check matched **0** stats (vacuously passed) | the harness regex assumed `stat="…" value="…"` order; real exports write **value-first** | `0mLsHPwVEPfp` · `fix(pob-validate): order-independent PlayerStat cross-check` |
| 2 | every item parsed with **0 mods** | PoB's **export** item format ≠ in-game clipboard — no `--------` dividers; mods after an `Implicits: N` marker with `{crafted}`/`{fractured}`/`{range:…}` tags | `0mLsHPwVEPfp` · `extractPobItemMods` (after `Implicits:`, tags stripped) → **0 → 239 mods** |
| 3 | every item `itemLevel = 0` | `Item Level: N` inline (no `----`) | `0mLsHPwVEPfp` · inline `Item Level:` extraction |
| 4 | multi-set builds parsed the **wrong skills** | `parseSkills` hardcoded `sets[0]`; leveling-guide builds carry many `<SkillSet>`s, active = `activeSkillSet` | `3rvtvz8dq0tc` (Slayer main read as a leveling skill) · `fix(pob): read the ACTIVE skill set…` |
| 5 | **no main skill** when `mainSocketGroup` points at an empty header group | the designated group held only annotation text | `QeQhGat81YVJ` (RF build, `<< Damage Skills >>` divider) · fall back to first group with an active gem |
| + | influence not surfaced | — | `influences` from `X Item` lines (e.g. Beast Jack = Shaper+Redeemer) |

All additive — existing clipboard-format fixtures untouched (new path gated on `Implicits:`; single-set builds
unchanged), so **parity holds, no snapshot churn**. Regression nets: `pobRealExport.test.ts` (the detailed
0mLsHPwVEPfp assertions) + `pobCorpus.test.ts` (data-driven over every `fixtures/real/*.txt`).

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

| Build | archetype | parse | identity | stat X-check | items/mods | notes |
|---|---|---|---|---|---|---|
| `0mLsHPwVEPfp` | Scion CI/1-life (Smite of Divine Judgement) | ✓ | Scion/Ascendant L100 | **✓ 94/94** (Life 1, ES 9916, Armour 1.05M, DPS 112M) | 33 / 239 (5 influenced) | exposed bugs #1–3 |
| `h-si3kweTn_N` | Ranger/Deadeye attack (Kinetic Blast) | ✓ | Ranger/Deadeye L98 | **✓ 98/98** (Life 3776, ES 1627, Eva 16016, DPS 12.5M) | 62 / 332 | bow/attack shape |
| `3rvtvz8dq0tc` | Duelist/Slayer attack (Ground Slam of Earthshaking) | ✓ | Duelist/Slayer L100 | **✓ 100/100** (Life 5091, Armour 12335, DPS 46M) | 74 / 323 | exposed bug #4 (active skill set) |
| `MpDjiqpnP2sV` | Templar/Hierophant spell (Kinetic Fusillade) | ✓ | Templar/Hierophant L94 | **✓ 96/96** (Life 4470, ES 1535, DPS 7.9M) | 59 / 288 | 16 tree specs (deep progression) |
| `Hmlt9phwV-hw` | Templar/Hierophant spell (Shock Nova) | ✓ | Templar/Hierophant L100 | **✓ 93/93** (Life 3626, ES 5218, Mana 8373, DPS 5.3M) | **166 / 1068** | very high item/mod count |
| `QeQhGat81YVJ` | Marauder/Chieftain (Righteous Fire) | ✓ | Marauder/Chieftain L100 | **✓ 97/97** (Life 8334, Armour 13009, CombinedDPS 3.35M) | 139 / 756 | exposed bug #5; RF → TotalDPS 58 vs CombinedDPS 3.35M (both surfaced) |

Archetype spread covered: CI/ES · bow + melee attack · spell · RF/degen · high-item-count · deep
multi-set progression · crafted/influenced gear. (A dedicated minion build would round it out — optional.)

## Notes / next

- Flag-don't-invent: I did **not** fabricate "real" exports to fill the corpus — synthetic fixtures can't
  validate real-world shapes, so that would defeat the increment. The corpus must be genuinely real.
- The harness is additive (no parser change yet) → parity holds. Fixes (if the real corpus exposes bugs) come
  next, each a cited correction.
- After the corpus validates: any deep extraction issue (e.g. an unusual skill's DPS) is a flagged follow-up,
  not crammed in.
