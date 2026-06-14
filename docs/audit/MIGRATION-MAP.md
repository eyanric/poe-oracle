# Unified Migration Map — Consolidated PoE 1 MCP

Target: one **read-only, TypeScript** MCP server callable from Claude Desktop + Code, consolidating
the **data/analysis** capabilities of VAAL, POEMCP, and ianderse/pob-mcp.

**Source-of-truth priority (per the brief):**
1. **PoB real calc engine** (ianderse Lua bridge) for any authoritative build stat — do not
   reimplement build math.
2. **Stable/static game data already in VAAL** (RePoE, modDefs, official tree JSON) or a documented
   API (poe.ninja API, official Trade/ladder APIs).
3. A structured service over a raw scrape.
4. **HTML scrape only where no stable source exists** (poedb-only fields, wiki mechanics) — marked
   ⚠ fragile.

> **Update (2026-06-13, economy slice):** poe.ninja's legacy `/api/data/*overview` endpoints are
> **dead** — Cloudflare-cached 404s for every path/header/league, and the PoE1 economy UI moved to
> `poe.ninja/poe1/...` with a non-public data API. The consolidated MCP's live economy source is now
> **poe.watch** (`api.poe.watch`, open, currently serving the live league with chaos/divine/listing
> data). The ported `PoeNinjaService` is kept dormant behind an `EconomyProvider` seam for if/when
> poe.ninja exposes a public API again. This affects capabilities **#7 `get_economy`/
> `currency_overview`** and **#8 `price_check_item`** below: chosen source = **poe.watch**, with the
> VAAL snapshot shape + the new `resolveCurrentLeague()` retained. Everything else is unchanged.
>
> **Update (2026-06-13, poe.ninja recovery):** poe.ninja did **not** die, it *relocated*. The
> current PoE1 economy API is the versioned stash namespace
> `https://poe.ninja/poe1/api/economy/stash/0/{currency|item}/overview?league={L}&type={T}&language=en`
> (+ `…/poe1/api/data/index-state` for leagues/versions), reverse-engineered from the live Astro site
> and confirmed empirically. It returns the legacy-style shape (`chaosEquivalent`,
> `receive.listing_count`, item `chaosValue/divineValue/listingCount`). Implemented as a NEW adapter
> `PoeNinjaProvider.ts` (the dead legacy `PoeNinjaService` stays deprecated). **poe.ninja is now a
> second LIVE provider** alongside poe.watch: `ECONOMY_PROVIDER` ∈ {`poewatch` (default), `poeninja`,
> `both`}. All economy rows now carry `lowConfidence` + `source`; the league resolver's fallback
> moved from the (now data-less) homepage scrape to `index-state`, and is rollover-hardened
> (never Standard during a gap).

---

## Capability → source-of-truth table

| # | Proposed MCP tool | Provided by | **Chosen source** | One-line justification |
|---|---|---|---|---|
| 1 | `get_build_stats` (DPS/EHP/res/defensive layers) | VAAL (export-time only), POEMCP (export-time only), **PoB MCP (recalc)** | **PoB MCP — Lua bridge `lua_get_stats`** | Only source that recomputes; identical to PoB GUI (priority 1). |
| 2 | `analyze_defenses` (avoidance/mitigation/recovery, EHP) | PoB MCP | **PoB MCP — Lua bridge** | Needs live recalculated layered stats. |
| 3 | `validate_build` (res/life/mana/accuracy/score) | PoB MCP | **PoB MCP** (Lua, XML fallback) | Authoritative checks off engine stats; degrade to XML. |
| 4 | `whatif_tree` (temporary node alloc → stat delta) | PoB MCP (`calc_with`) | **PoB MCP — Lua bridge** | What-if requires the engine; nothing else can. |
| 5 | `analyze_tree` (diffs, path-to-node, nearby notables) | POEMCP (tree JSON), **PoB MCP (TreeService, XML tier)** | **PoB MCP tree-analysis logic** over **official tree JSON** | Best ready-made graph logic; data is official GGG export (priority 2). |
| 6 | `parse_pob` (export/URL → structured summary) | **POEMCP**, willfindlay, VAAL(ItemParser only) | **POEMCP `parse_pob`** (ported to TS) | Complete export→summary incl. pobb.in/pastebin fetch; engine-free fallback for #1 (priority 2/3). |
| 7 | `get_economy` / `currency_overview` (prices→chaos) | **VAAL PoeNinjaService**, POEMCP, PoB MCP | **VAAL snapshot shape + POEMCP `_get_current_league()`** | VAAL's typed multi-category snapshot is richest; add POEMCP's live-league resolver (priority 2). |
| 8 | `price_check_item` (clipboard → price) | **VAAL ItemPricerService** | **VAAL** (ninja → trade → poeprices cascade) | Multi-source cascade already built; just needs #7's league fix. |
| 9 | `search_mod_pool` / `hit_probability` (craft odds) | **VAAL RePoEService** | **VAAL RePoE engine** | RePoE-fork weights + influence/fossil math; stable static CDN (priority 2). |
| 10 | `calc_craft_cost` (expected attempts + orb breakdown) | **VAAL PoeNinjaService.calculateCraftCost** | **VAAL** | Weight-aware cost model already consumes RePoE + ninja prices. |
| 11 | `trade_search` / `trade_fetch` (query build + listings) | **VAAL TradeApiService**, PoB MCP (opt-in) | **VAAL TradeApiService** | Full Awakened-style query builder + stat-ID index + listing parse (priority 2). |
| 12 | `search_passive` / `get_passive_detail` | **POEMCP** | **Official tree JSON** (`grindinggear/skilltree-export`) | Official data; reuse POEMCP's classify/fuzzy logic (priority 2). |
| 13 | `search_base_items` / `get_base_item` (bases, tags, reqs) | **VAAL RePoEService** | **VAAL RePoE** | `base_items` + `item_classes` already loaded; no scrape needed. |
| 14 | `search_gem` / `get_gem_detail` (incl. level-effect tables) | **POEMCP (poedb)** | **POEMCP poedb scrape** ⚠ | No stable structured source for gem level tables; poedb-only. |
| 15 | `search_maps` / `map_detail` | **POEMCP (poedb)** | **POEMCP poedb scrape** ⚠ | Maps/atlas data — VAAL has none; poedb-only. |
| 16 | `search_scarabs` / `scarab_detail` | **POEMCP (poedb)** | **POEMCP poedb scrape** ⚠ | Scarab effects/limits — poedb-only. |
| 17 | `search_item_mods` (per-base prefix/suffix, poedb fields) | **POEMCP (poedb)**, VAAL (RePoE + modDefs) | **VAAL RePoE first; POEMCP poedb to fill gaps** ⚠ | Prefer RePoE weights; scrape poedb only for fields RePoE lacks. |
| 18 | `wiki_mechanics` (cleaned wiki page) | **POEMCP** | **POEMCP `fetch_wiki_page`** ⚠ | No stable API for prose mechanics; reuse the noise-stripper. |
| 19 | `get_leagues` / resolve current league | **VAAL PoEApiService**, POEMCP | **VAAL `/api/leagues`** + **POEMCP ninja-homepage fallback** | Official ladder API is canonical; ninja-scrape backs up economy-league naming. |
| 20 | `get_stash` / `get_characters` (my account) | **VAAL PoEApiService** | **VAAL** (official PoE API + POESESSID) | Reads my own account/stash via official, rate-limited API. |

**Net source-of-truth split:** PoB engine → #1–5 (build stats/defense/validate/what-if/tree).
VAAL → #7–11, 13, 19–20 (economy, pricing, craft math, trade, bases, leagues, account). POEMCP →
#6, 12, 14–18 (PoB parse fallback, passives, gems, maps, scarabs, wiki). **Only #14–18 remain
scrapes** (poedb gems/maps/scarabs/mod-fields + wiki) — everything authoritative is API/engine/static.

---

## EXCLUDED (VAAL automation — stays out entirely)

Inventoried, **not** ported, not hardened, not extended:

- `AutomationService` — bezier/jittered mouse+keyboard crafting/unload/flask executors.
- `HumanInput` ban-resistance layer — bezier paths, Gaussian/jittered delays, cadence drift,
  fatigue/click-storm prevention. *(Exception: its stateless `TokenBucket` / `withBackoff` / `sleep`
  helpers are reused by KEEP API clients and may be copied as plain rate-limit utilities — the
  evasion behaviors are not.)*
- `BeastService` + `BeastManager.tsx` — Bestiary click automation (the static beast-recipe table is
  reusable reference data, not the automation).
- `HotkeyService` — global hotkeys that trigger automation.
- `ProcessDetector` — PoE-window detection for clicking.
- `FlaskManager.tsx`, `Calibration.tsx` — flask automation + screen-coordinate calibration.
- The **input executors** inside `ItemCrafting.tsx` / `StashManager.tsx` / `MapCrafting.tsx` /
  `Recipes.tsx` (the `automation.start(...)` halves of those SPLIT pages). Their **read/analysis
  halves** (RePoE mod pool, stash read, recipe evaluation) are KEEP and covered above.
- All `craft_pos_*` / `layout_*` / calibration settings keys.

---

## PORT FROM (lift these specific pieces)

Classified **PORT** (translate to TS), **REFERENCE** (use as a guide), **SKIP** (already covered).

| Piece | From | Action | Notes |
|---|---|---|---|
| `parse_pob` export→summary | POEMCP `scrapers/player/pob.py` | **PORT** | base64+zlib+XML, pobb.in/pastebin fetch, active set/spec selection, `{tag}`/color strip, keystone/notable resolve, progression-stage grouping. Engine-free fallback for build stats. |
| `_get_current_league()` live-league resolver | POEMCP `scrapers/economy/pricing.py` | **PORT** | Fixes VAAL's broken economy. Scrape ninja homepage `/(economy\|challenge)/<league>`, validate against API, cache 1 h. |
| Wiki nav/noise stripper | POEMCP `scrapers/wiki.py` | **PORT** | Section whitelist/blacklist, hoverbox removal, table→md, heading-aware walker. |
| PoB **Lua engine bridge** | ianderse `src/pobLuaBridge.ts` (+ `luaClientManager`) | **PORT** | stdio JSON-lines to `luajit HeadlessWrapper.lua`; expose read-only `lua_get_stats`/`get_tree`/`calc_with`. GPL-3.0 — keep license compatibility in mind (see below). |
| Tree-analysis logic | ianderse `TreeService` / `treeHandlers.ts` | **PORT/REFERENCE** | Node diffs, path-to-node, nearby notables, archetype detect — runs on XML/official tree JSON, no engine needed. |
| `analyze_defenses` / `validate_build` heuristics | ianderse handlers | **REFERENCE** | Reuse the layer model + thresholds; feed them PoB-engine stats. |
| poedb maps/scarabs/gem-detail scrapers | POEMCP `scrapers/env/*`, `player/gems.py` | **REFERENCE** | VAAL lacks this coverage; reuse slug maps + CSS selectors. Mark fragile. |
| poedb per-base mod fields | POEMCP `scrapers/mods/item_mods.py` | **REFERENCE** | Only for fields RePoE doesn't carry; RePoE weights remain source of truth. |
| RePoE mod-pool + hit-probability | VAAL `RePoEService` | **SKIP** (already TS, just relocate) | Core crafting math; lift as-is. |
| poe.ninja snapshot + `calculateCraftCost` | VAAL `PoeNinjaService` | **SKIP** (relocate) | Keep typed snapshot; bolt on the ported league resolver. |
| Trade query builder + stat-ID index | VAAL `TradeApiService` | **SKIP** (relocate) | Reuse `buildSearchQuery`/`findStatId`. |
| ItemParser clipboard grammar | VAAL `ItemParser` | **SKIP** (relocate) | Shared by price-check + any item-input tool. |
| willfindlay typed PoB structs / multi-set selection | willfindlay `tools/tools.go` | **REFERENCE** | Output-shape + skill/item/config-set selection guide for `parse_pob`. |

---

## Runtime / infra implications of the PoB-engine bridge

The PoB engine is the highest-value capability **and** the heaviest infra cost:

- **It is not pure data** — it needs **LuaJIT** + a **PathOfBuilding fork on the `api-stdio` branch**
  (`HeadlessWrapper.lua` + `Modules/` + PoB's tree/data files) present on disk, located by
  `POB_FORK_PATH`. The MCP must either bundle/vendor that fork or document a setup step.
- **A long-lived `luajit` subprocess** runs alongside the MCP (stdio JSON-lines, ~30 s timeout,
  throttled). Local-only, no external network for calc; teardown on exit. Windows `LUA_PATH`/
  `LUA_CPATH` wiring is required (the bridge already handles it).
- **License:** the bridge code is **GPL-3.0**; the PoB fork is also GPL. If we port that bridge
  verbatim, the consolidated server inherits GPL obligations — decide license posture before lifting
  (clean-room reimplementation of the thin stdio protocol is an option to avoid it).
- **Graceful degradation is mandatory:** when `POB_LUA_ENABLED` is off / LuaJIT or the fork is
  missing, fall back to **`parse_pob`** (export-time `<PlayerStat>`) so build tools still return
  *something* — clearly labeled "from PoB export, not recalculated."
- **Optional TCP mode** can attach to a user's already-running PoB GUI (loopback :31337) instead of
  spawning headless — lighter when the user has PoB open, but requires launching PoB with
  `POB_API_TCP=1`.

**Recommendation:** ship the data/analysis tools (VAAL + POEMCP-ported) as the always-on core with
**zero native deps**, and gate the PoB-engine tools behind a feature flag that requires the LuaJIT +
fork setup — exactly the `POB_LUA_ENABLED` model ianderse already uses.
