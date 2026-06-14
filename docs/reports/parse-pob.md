# Report — `parse_pob` + passive-tree analysis (ORACLE build/gameplay side)

**Date:** 2026-06-14 · **League:** 3.28 Mirage · **Status:** shipped, gates green (144 tests).

Opens the build/gameplay side: decode Path of Building exports, analyze the GGG passive tree, and
feed parsed builds into the existing build-cost estimator. Upgrade-pathing was explicitly **out of
scope** (needs weapon/DPS pricing — see end). No Track B, no automation. Clean-room throughout
(parse the export *format* + consume GGG's *data export*; no PoB source lifted). Layering
`tools/ → services/ → data/` held; ESLint layer rule green.

## What shipped

### Phase 1 — `parse_pob`
- **[data/pob.ts](../../src/data/pob.ts):** link resolver — `pobb.in/<id>` and `pobb.in/u/<user>/<id>`
  → append `/raw`; `pastebin.com/<id>` → `/raw/<id>`; a non-URL is treated as a raw pasted code.
  Fetches the raw export code on the shared `fetchText` cache.
- **[services/pobParser.ts](../../src/services/pobParser.ts):** decode (`base64url → zlib-inflate → XML`,
  with `inflateRaw`/`gunzip` fallbacks) + a minimal tolerant XML reader (no new dependency) + structured
  extraction: class / ascendancy / level, gem links by slot (active vs support), every equipped item
  with mods (reusing `ItemParser`), PoB-reported stats, and the passive-tree spec(s) with allocated node
  ids + counts + titles (progression stages).
- **[tools/pob.ts](../../src/tools/pob.ts):** `parse_pob` tool. When tree data is available it resolves
  allocated ids to keystone/notable/mastery **names** (Phase 2); otherwise returns ids + counts.

### Phase 2 — passive-tree analysis
- **[data/passiveTreeData.ts](../../src/data/passiveTreeData.ts):** loads GGG's **official** export
  (`grindinggear/skilltree-export/data.json`, `POE_TREE_URL`-overridable) via `fetchJson`.
- **[services/passiveTree.ts](../../src/services/passiveTree.ts):** normalize to an undirected graph;
  `lookupNode` (by id/name), `pathBetween` + `distance` (BFS), `statsForNodes` ("allocate X → stat
  delta"), and `classifyAllocated` (id set → keystones/notables/masteries). Pure core + cached live loaders.
- **`passive_tree` tool** (lookup / path / stats ops).

### Phase 3 — integration (cheap win)
- **[buildCost.ts](../../src/services/buildCost.ts):** `gearListFromPob` (PoB items → priceable gear
  list) + `estimateBuildCostFromPobLive`. `estimate_build_cost` now takes a `pob` link/code directly —
  the PoB import hook Track B B2 left open is filled.

## Validation

### Parse — what parsed cleanly vs choked
Two real-FORMAT exports (a leveling Witch and an endgame Necromancer), authored to PoB's exact export
schema and built via `scripts/make-pob-fixtures.mjs` (`base64url(zlib(XML))`), parse end to end:

| Fixture | Parsed |
|---|---|
| leveling | Witch (no ascend) lvl 42 · main **Freezing Pulse** · 2 gem groups · 2 items w/ mods · 25 tree nodes |
| endgame | Witch/**Necromancer** lvl 95 · main **Raise Spectre** + 3 supports · Belly of the Beast / Headhunter / rare ring by slot · stats (Life 5200, DPS 3.55M) · 109 nodes |

**Edge cases handled:** URL-safe base64 (`-_` → `+/`) + zlib codec fallbacks; XML attributes/entities/
self-closing tags/text bodies; `ascendClassName="None"` normalized to empty; support-gem detection by
name/skillId; the active `ItemSet` slot map joined to `<Item>` bodies. **One real quirk found + handled:**
`ItemParser` routes *short* mod sections (≤4 plain lines after `Item Level`) to *implicits* — so PoB items
with few mods lost their explicit lines. `gearListFromPob`/the parser now merge affix+implicit+enchant so
all mod lines survive (the fix is in `parseItems`).

**Honest limit:** a live third-party fetch (pobb.in/pastebin/mobalytics/pobarchives) was **HTTP 403** in
this environment, so I could not pull a genuine community export for the corpus. The fixtures are authored
to the exact export pipeline (identical decode path), the link-resolver + decoder are unit-tested, and the
live tree + live pricing paths below ran for real. Swapping in a live code later needs no code change.

### Tree queries on known nodes (LIVE GGG export — `npm run smoke:pob`)
- Loaded **3337 nodes** (tree "Default").
- `lookup "Chaos Inoculation"` → id **11455**, type **keystone**, stats "Maximum Life becomes 1, Immune to
  Chaos Damage".
- `distance(Chaos Inoculation → Point Blank)` = **16 points**, path 17 nodes.
- `classifyAllocated([11455, …neighbours])` → keystones **[Chaos Inoculation]**, unresolved 0.
- Unit tests (`test/passiveTree.test.ts`) cover lookup-by-id/name, chain + branch pathing, self/unknown
  distance, stat-delta aggregation, and keystone/notable/mastery classification on a fixture tree.

### Build-cost integration (LIVE prices)
`estimate_build_cost` from the parsed endgame export, league Mirage:

```
tier starter · total 4591c (8.16 div) · 1 unpriced
  Body Armour: Belly of the Beast = 6c
  Belt: Headhunter = 4586c (~8 div)
  Ring 1: Opal Ring = unpriced (rare/unindexed)
```
Uniques priced live; the rare ring correctly flagged unpriced (lower-bound, as designed). One unit test
asserts a parsed export produces a cost estimate with uniques priced + rares flagged.

## Gate status
typecheck ✅ · lint ✅ (layering green) · **144 tests** ✅ (+50: pobParser 14, passiveTree 11, integration
2, + existing) · build ✅ · `smoke:pob` ✅ (live).

## Tools added
`parse_pob`, `passive_tree`, and a `pob` input on `estimate_build_cost`.

## Out of scope (deliberate) / next
- **Upgrade-pathing** ("best DPS/EHP-per-divine upgrade for my budget") was not built — it needs to price
  the user's existing gear, much of which is **weapons**, and rare pricing can't do weapons yet (DPS-based
  valuation, a separate problem). `parse_pob` is built so that track can sit on top of it cleanly:
  `ParsedPob.items` (with slots + mods) and `passive_tree`/`gearListFromPob` are the hooks. Upgrade-pathing
  should pair with a **weapon/DPS-pricing extension** as a combined future track.
- No Track B work; no automation.
