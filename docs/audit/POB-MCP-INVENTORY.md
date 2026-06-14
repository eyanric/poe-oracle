# PoB MCP Inventory (read-only reference)

Two implementations were cloned and inventoried. **`ianderse/pob-mcp` is the one to lift from** —
it is the only one that bridges PoB's *real calculation engine*. `willfindlay/pob-mcp` is an
XML-only reader (no engine) and adds little beyond clean structured output.

| Repo | Lang | PoB engine? | Tools | License | Local path |
|---|---|---|---|---|---|
| **ianderse/pob-mcp** | TypeScript (Node, MCP SDK) | **Yes — LuaJIT bridge to a PoB fork**, with XML fallback | **91** across 10 categories | **GPL-3.0** | `reference/pob-mcp` |
| willfindlay/pob-mcp | Go (`go-sdk/mcp`) | No — XML unmarshal + base64 decode only | 8 | none declared | `reference/pob-mcp-willfindlay` |

---

## A. ianderse/pob-mcp — how it gets PoB stats

**Two tiers, feature-flagged by `POB_LUA_ENABLED`:**

### 1. XML-based tools (always available)
`fast-xml-parser` over PoB `.xml` build files in `POB_DIRECTORY`. Reads the **pre-computed
`<PlayerStat>` values** PoB wrote at save time — *not recalculated*. `chokidar` watches the builds
dir for live changes. Tools: `list_builds`, `analyze_build`, `compare_builds`, `get_build_stats`,
`get/set_build_notes`, `start/stop_watching`, `watch_status`, `get_recent_changes`,
`refresh_tree_data`.

**Tree-analysis tools are also XML-tier (always available):** `compare_trees`, `get_nearby_nodes`,
`find_path_to_node`, `get_passive_upgrades`, `suggest_masteries`. A `TreeService` analyzes allocated
node IDs from the XML against tree data (archetype detection, node diffs, path-finding, nearby
notables). These do **not** require the Lua engine, though some optionally consult a Lua client if
present.

### 2. Lua bridge tools (require `POB_LUA_ENABLED=true`) — the real engine
`src/pobLuaBridge.ts` **spawns `luajit HeadlessWrapper.lua`** in a PoB fork's `src/` dir
(`POB_FORK_PATH`), env `POB_API_STDIO=1`, and talks **newline-delimited JSON over stdio** (one
long-lived process; `bottleneck`-throttled). Request envelope `{action, params}` → response
`{ok, ...}`. Actions: `ping`, `load_build_xml`, `get_stats`, `get_tree`, `set_tree`,
`update_tree_delta`, `calc_with` (what-if), `export_build_xml`, `get_build_info`, `set_level`,
`get_config`, `set_config`, `quit`.

This recomputes stats with **PoB's own calc code → identical to the PoB GUI**. It is the
authoritative source for DPS / EHP / resistances / defensive layers and is the **one thing neither
VAAL nor POEMCP can reproduce** (they only read PoB's export-time numbers).

**Optional TCP mode** (`POB_API_TCP=1`, default port 31337, loopback only): instead of spawning a
headless process, attach to a **running PoB GUI** with an embedded `src/API/TcpServer.lua` pumped
each frame. Same JSON actions. (`PoBLuaTcpClient` in the bridge.)

#### Lua-bridge capability groups
- **Core build/tree:** `lua_start/stop`, `lua_new_build`, `lua_load_build`, `lua_save_build`,
  `lua_reload_build`, `lua_get_build_info`, `set_character_level`, `lua_get_stats`
  (`offense`/`defense`/`all`), `lua_get_tree`, `lua_set_tree`, `update_tree_delta`,
  `search_tree_nodes`, spec CRUD (`list/select/create/delete/rename_spec`), item-set
  list/select, `plan_leveling`.
- **Items & skills:** `add_item`/`add_multiple_items` (from PoE clipboard text),
  `get_equipped_items`, `toggle_flask`, socket-group + gem CRUD (`create_socket_group`, `add_gem`,
  `set_gem_level/quality`, `remove_gem/skill`, `set_main_skill`, `setup_skill_with_gems`).
- **Optimization (live-stat driven):** `analyze_defenses` (3-layer avoidance/mitigation/recovery
  EHP audit), `suggest_optimal_nodes` (goal-aware), `optimize_tree`, `analyze_items`,
  `optimize_skill_links`, `create_budget_build`, `get_build_issues`, `check_boss_readiness`,
  `suggest_watchers_eye`.
- **Config/enemy:** `get/set_config` (charges, buffs, `enemyIsBoss`), `set_enemy_stats`,
  config-preset save/load/list.
- **Validation:** `validate_build` — resistances/life/layers/mana/immunities/accuracy/damage,
  severity-classified, 0–10 score; Lua stats when available, else XML fallback.
- **Skill-gem analysis:** `analyze_skill_links` (archetype detect), `suggest_support_gems`,
  `validate_gem_quality`, `compare_gem_setups`, `find_optimal_links`, `gem_upgrade_path`.
- **Export/persistence:** `export_build`, `save_tree`, `snapshot_build`, `list/restore_snapshot`,
  `export_build_summary` (snapshots in `POB_DIRECTORY/.pob-mcp/snapshots/`).
- **Currency (poe.ninja):** `get_currency_rates`, `find_arbitrage`, `calculate_trading_profit`
  (needs **exact** league name — same league-resolution gap as VAAL).
- **Trade API (opt-in `POE_TRADE_ENABLED`):** `search_trade_items`, `get_item_price`, `get_leagues`,
  `search_stats`, `find_item_upgrades`, `find_resistance_gear`, `compare_trade_items`,
  `search_cluster_jewels`, `analyze_build_cluster_jewels`, `generate_shopping_list`.

### Build create/modify capability
**Yes — full mutation** via the Lua bridge: create builds from class/ascendancy, edit tree
(set/delta), add items/gems, toggle flasks, set level/config/enemy, save back to XML, snapshot &
rollback. (For our **read-only** consolidation, mutation tools are out of scope — we want the
*read/analysis* surface: `lua_get_stats`, tree analysis, `validate_build`, `analyze_defenses`,
what-if `calc_with`.)

### Runtime prerequisites of the engine bridge
- **LuaJIT** binary on `PATH` (or `POB_CMD` full path).
- A **PathOfBuilding fork checked out on the `api-stdio` branch** (the README points to
  `ianderse/PathOfBuilding`), with `src/HeadlessWrapper.lua` + `Modules/` present; `POB_FORK_PATH`
  → that `src/`. Requires the PoB tree/data files the fork ships.
- `POB_DIRECTORY` for `.xml` builds; `POB_TIMEOUT_MS` (default 10 000, bumped to 30 000 in code).
- The headless process is **long-lived, local-only, no external network** for calc. One hot process
  per MCP instance; teardown on exit. Windows path handling for `LUA_PATH`/`LUA_CPATH` is built in.
- Failure modes the README documents: missing `luajit`, "Failed to find valid ready banner" (bad
  `POB_FORK_PATH`), timeouts (raise `POB_TIMEOUT_MS`), gem edits not serialized back to XML on save.

**Implication:** bridging the real engine means **shipping/locating a PoB fork + LuaJIT alongside
the MCP**. That is the single biggest infra cost of the consolidation (see MIGRATION-MAP).

---

## B. willfindlay/pob-mcp — XML-only Go reader

`main.go` registers **8 tools** (`tools/tools.go`); `pob/decode.go`+`xml.go` decode a base64 build
string or `xml.Unmarshal` a `.xml` file. **No Lua, no recalculation** — `StatValue()` reads
pre-computed `<PlayerStat>` entries.

Tools: `list_builds`, `load_build` (path **or** base64 build string), `get_build_summary`,
`get_build_stats` (substring filter), `get_build_skills` (per skill-set), `get_build_items`
(per item-set, slot filter), `get_build_tree` (spec node count, masteries, jewel sockets, overrides,
tree URL), `get_build_config` (config toggles + enemy settings), `get_build_notes` (color-stripped).

**What it adds over POEMCP's `parse_pob`:** clean **typed JSON output** (jsonschema-annotated
structs), first-class **multi-set handling** (skill/item/config sets + tree specs by id/index), and
both file-path and build-string loading. **What it doesn't add:** any calculation — same export-time
stats as POEMCP. License: none declared.

**Verdict:** **REFERENCE** for output shape / multi-set selection; **SKIP** as a source of truth
(superseded by the ianderse Lua bridge for stats and by POEMCP `parse_pob` for export parsing).

---

## Bottom line
- **Authoritative build math → ianderse Lua bridge.** Only source that *recalculates* (DPS/EHP/res/
  defensive layers) identical to PoB GUI. GPL-3.0; needs LuaJIT + a PoB fork at runtime.
- **PoB export → structured summary (no engine) → POEMCP `parse_pob`** (or willfindlay's structs as
  a typing guide). Good offline fallback when the bridge is unavailable.
- **Tree analysis (diffs, paths, nearby notables, what-if allocation)** exists in ianderse at the
  XML tier (doesn't strictly need the engine) — worth porting the logic.
