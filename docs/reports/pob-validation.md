# Report — real-export `parse_pob` validation

**Date:** 2026-06-16 · **Status:** ⏸ **blocked on corpus sourcing** — harness built + verified on existing fixtures; needs ~6–8 real PoB codes (see "What I need"). Gates green (typecheck ✓ · lint ✓ · 395 tests ✓ · build ✓).

The crux: a PoB export embeds PoB's **own computed stats** (`<PlayerStat stat value/>`). The validation
ground-truths our extracted Life/ES/DPS/resist against those — not "did it parse." The harness + cross-check
are built and proven on the existing fixtures; the **real, diverse corpus is the missing piece**.

## ⚠ What I need from you (sourcing is blocked)

I could not autonomously assemble a real current-league corpus. What I found:

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

## Per-build validation table (awaiting corpus)

_To be filled when the codes land — one row per real build: parse ✓/✗ · stat-match ✓/✗ (worst delta) ·
items/mods ✓/✗ · tree ✓/✗ · notes. Any output-changing parser fix will cite the build + field that exposed
it (old→new), each its own commit._

## Notes / next

- Flag-don't-invent: I did **not** fabricate "real" exports to fill the corpus — synthetic fixtures can't
  validate real-world shapes, so that would defeat the increment. The corpus must be genuinely real.
- The harness is additive (no parser change yet) → parity holds. Fixes (if the real corpus exposes bugs) come
  next, each a cited correction.
- After the corpus validates: any deep extraction issue (e.g. an unusual skill's DPS) is a flagged follow-up,
  not crammed in.
