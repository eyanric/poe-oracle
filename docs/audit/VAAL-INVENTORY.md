# VAAL Inventory (read-only audit)

VAAL = Electron 29 + React 18 + MUI v5 + TypeScript, packaged as a portable Windows `.exe`.
All backend logic lives in **main**; the renderer only calls `window.api.*`. IPC contract in
`src/shared/types.ts → IpcApi`.

**Classification key (VAAL exclusion rule):**
- **KEEP** — reads/analyzes data (game data, economy, my account/stash via official APIs, PoB
  parse, crafting math, trade-query building/parsing).
- **EXCLUDE** — automates game input or evades detection.
- **SPLIT** — borderline; read half KEEP, input half EXCLUDE (flagged ⚑).

---

## Build / runtime setup

| Aspect | Detail |
|---|---|
| Bundler | `electron-vite` 2 (esbuild for build/package — **no typecheck on build**) |
| Typecheck | `tsc -p tsconfig.node.json` + `tsconfig.web.json`, `--noEmit`, strict |
| Lint / test | ESLint flat config; Vitest (`test/*.test.ts`, electron-log stubbed) |
| Packaging | `electron-builder` → portable `dist/vaal.exe`; `resources/` shipped as extraFiles |
| Runtime deps | MUI, framer-motion, zustand, react-router, `ini`, `electron-log`, **`@nut-tree-fork/nut-js`** (native input — EXCLUDE-only) |
| Process model | Main (Node) ↔ Preload (contextBridge) ↔ Renderer (React) |
| Settings | `resources/settings.ini` via `ini`; every field is `string \| undefined` |

The **only runtime dependency tied to automation** is `@nut-tree-fork/nut-js` (lazy-loaded in
`AutomationService`/`BeastService`). A data/analysis-only MCP needs none of it.

---

## Main services (`src/main/services`)

| Service | Purpose | Data source | Key deps | State | Class |
|---|---|---|---|---|---|
| **PoEApiService** | Official PoE API client: leagues, characters, stash tabs/items. Rate-limited (TokenBucket + X-Rate-Limit backoff), POESESSID auth, caching. | **Stable API** `www.pathofexile.com` (`/api/leagues`, `/character-window/get-characters`, `/character-window/get-stash-items`) | https, zlib, HumanInput (TokenBucket/backoff only) | Working (needs POESESSID) | **KEEP** — reads my own account/stash via official API |
| **PoeNinjaService** | Economy snapshot (currency, fragments, essences, div cards, uniques, gems, maps, scarabs) → chaos values; `buildPriceMap`; crafting-opportunity + craft-cost math. | **Legacy poe.ninja API** `/api/data/currencyoverview`, `/api/data/itemoverview` | https, zlib | **Broken** live (see Economy deep-dive) | **KEEP** — economy reads + crafting cost/probability math |
| **ItemPricerService** | Multi-source price check for a clipboard item: poe.ninja → Trade API → poeprices.info ML. | poe.ninja, PoE Trade API, `poeprices.info` | PoeNinja, TradeApi, ItemParser | Working except ninja leg (depends on PoeNinjaService) | **KEEP** — price lookup/analysis |
| **TradeApiService** | PoE Trade search/fetch (Awakened-PoE-Trade flow): builds stat-filter query from a parsed item, normalizes listing prices to chaos; stat-ID index from `/api/trade/data/stats`. | **Stable API** `www.pathofexile.com/api/trade/*` | https, zlib, TokenBucket | Working (needs POESESSID for search) | **KEEP** — trade query building + listing parsing |
| **RePoEService** | Game-data engine: mods, base items, item classes, essences, fossils, stat translations, crafting-bench options; computes per-base **mod pool** (spawn weights, influence/fossil tags) and **hit probability**. | **Stable static CDN** `repoe-fork.github.io/*.min.json` (auto-updated per patch) | https, zlib | Working | **KEEP** — authoritative-ish static game data + crafting math |
| **ItemParser** | Parse PoE clipboard text → structured item (rarity, base, class, ilvl, mods by category, links, influences, etc.). Two parsers: `parseClipboardItemText` (pricing) and `parseAutomationItemText` (automation). | n/a (pure text) | — | Working (known implicit-fallback quirk, see CLAUDE.md) | **KEEP** — parsing/analysis (the automation parser is incidental) |
| **RecipeEngine** | Determine chaos/regal/GCP recipe sets from scanned stash items; summarize counts. | n/a (operates on `PoeItem[]` from PoEApiService) | StashScanner | Working | **KEEP** — reads/analyzes stash data (the click-sequence half is EXCLUDE) ⚑ |
| **StashScanner** | Classify stash items into recipe slots (chaos ilvl 60-74, regal 75+, GCP gems), score sets. | n/a (operates on `PoeItem[]`) | — | Working | **KEEP** — pure analysis of stash data |
| **AutomationService** | Ban-resistant mouse/keyboard automation: bezier paths, jittered Gaussian delays, TokenBucket, stop-on-focus-loss; crafting/unload/flask executors. | nut-js native input | HumanInput, ItemParser, ProcessDetector | Working | **EXCLUDE** — automates game input |
| **HumanInput** | Ban-resistance primitives: `gaussianRandom`, `bezierPath`, `jitterPoint`, `humanDelay`, `TokenBucket`, `withBackoff`. | n/a | — | Working | **EXCLUDE** (detection evasion) — *but* `TokenBucket`/`withBackoff`/`sleep` are reused by KEEP API clients ⚑ |
| **BeastService** | Bestiary automation: type regex in search bar, Ctrl+Click portraits, screenshot-diff to detect empty. | nut-js, electron clipboard, screenshots | AutomationService, ProcessDetector | Working | **EXCLUDE** — automates game input |
| **HotkeyService** | Register global Electron accelerators that fire automation actions (start/stop/chain_craft/scan/unload). | Electron `globalShortcut` | — | Working | **EXCLUDE** — triggers automation |
| **ProcessDetector** | Find PoE window via `tasklist`/WMIC; window rect for calibration. | Windows shell | child_process | Working | **EXCLUDE** — supports clicking/calibration |
| **SettingsService** | Read/write `resources/settings.ini`; craft templates. Default `selected_league: 'Standard'`. | `ini` file | fs, ini | Working | **SPLIT** ⚑ — config store (KEEP for league/auth/economy keys; many keys are automation calibration = EXCLUDE) |
| **Logger** | Forward log entries to renderer + electron-log. | n/a | electron-log | Working | Support (neutral) |

### Notable extractable logic (KEEP)
- `RePoEService.getModPool()` / `calculateHitProbability()` — RePoE-fork weights + influence/fossil
  tag math. This is the crafting-probability core.
- `PoeNinjaService.calculateCraftCost()` — alt-aug-regal / chaos-spam / alch-scour / transmute-alt /
  essence expected-attempts + orb breakdown, weight-aware (consumes RePoE weights).
- `TradeApiService.buildSearchQuery()` + `findStatId()` — item→trade-query construction and the
  mod-text→stat-ID fuzzy index. Reusable for a trade-search tool.
- `ItemParser` clipboard grammar.

---

## Renderer pages (`src/renderer/src/pages`)

| Page | Purpose | Backend it drives | Class |
|---|---|---|---|
| **Economy.tsx** | Economy dashboard: snapshot tables, item price-check (paste), craft-cost calc, crafting opportunities, RePoE mod-pool + hit-prob, **direct Trade search/fetch**. | economy.*, repoe.*, trade.*, crafts.* | **KEEP** — pure data/analysis UI |
| **ItemCrafting.tsx** | Craft simulator: pick base/influences → RePoE mod pool, build craft templates… then **runs the click automation** to execute the craft. | repoe.*, crafts.* (KEEP) + automation.start (EXCLUDE) | **SPLIT** ⚑ |
| **StashManager.tsx** | View stash tabs/items (read via API) + **unload automation**. | poe/stash read (KEEP) + automation.start unload (EXCLUDE) | **SPLIT** ⚑ |
| **Recipes.tsx** | Recipe config UI (chaos/regal/GCP rules); persists to settings. Evaluation is RecipeEngine; execution is automation/hotkey. | settings store only | **SPLIT** ⚑ — config for a KEEP-eval / EXCLUDE-exec feature |
| **MapCrafting.tsx** | Map-mod profile builder + apply-to-map run button. | settings + automation | **SPLIT** ⚑ (reference data KEEP, apply EXCLUDE) |
| **BeastManager.tsx** | Beast itemise/remove automation UI; also a **static beast-recipe reference table** (S/A/B tiers). | beast.* (EXCLUDE) | **EXCLUDE** (but the static recipe table is portable reference) |
| **FlaskManager.tsx** | Flask auto-use config + start/stop. | automation.* | **EXCLUDE** — flask automation |
| **Calibration.tsx** | Capture screen coordinates for clicking. | automation.getMousePos, settings | **EXCLUDE** — screen-coordinate calibration |
| **Settings.tsx** | App settings incl. league, POESESSID, hotkey registration. | settings.*, hotkeys.* | Support (KEEP for league/session fields; hotkey reg is EXCLUDE) |
| **Dashboard.tsx** | Status overview. | mixed | Support (UI) |

---

## Shared types / data / scripts

| File | What | Class |
|---|---|---|
| `src/shared/types.ts` | `Settings`, `League`, `StashTab`, `IpcApi`, `CraftTemplate`, `CalibrationPoint`. Settings is mostly automation calibration keys. | Reference |
| `src/shared/constants.ts` | `STASH_TAB_TYPES`, `CURRENCY_ORBS`, `HOTKEY_ACTIONS`, `FLASK_TYPES`, **`DEFAULT_LEAGUES = ['Standard','Hardcore','SSF Standard','SSF Hardcore']`** (no live challenge league). | Reference (note the league gap) |
| `src/renderer/src/data/modDefs.ts` | **Generated** explicit-mod database (prefix/suffix, tiers, value ranges) for the craft UI. | **KEEP** (vendored static data) |
| `src/renderer/src/data/craftTypes.ts` | Craft-template types (`DesiredMod`, match modes, weights). | Reference |
| `scripts/gen-mods-wiki.js` | **HTML scraper** of `poewiki.net/List_of_modifiers_for_*` (JSDOM, 1.5 s rate-limit) → `modDefs.ts`. Fragile (depends on wiki table markup). | **KEEP-ish** (build-time scraper; fragile — RePoE preferred) |
| `src/renderer/src/store/appStore.ts` | Zustand global state incl. `selectedLeague`, settings. | Reference |

---

## Economy path deep-dive (currently failing)

**Call graph:** `Economy.tsx` (`selectedLeague`) → `window.api.economy.getSnapshot(league)` →
`handlers.ts economy:getSnapshot` → `PoeNinjaService.getEconomySnapshot(league)`.

**Exact endpoints** (host `poe.ninja`, `User-Agent: VAAL/2.1.0 (personal stash management tool)`,
10-min cache):
- `GET /api/data/currencyoverview?league=<league>&type=Currency`
- `GET /api/data/currencyoverview?league=<league>&type=Fragment`
- `GET /api/data/itemoverview?league=<league>&type=<T>` for `T ∈ {Essence, DivinationCard,
  UniqueWeapon, UniqueArmour, UniqueAccessory, UniqueFlask, UniqueJewel, SkillGem, Map, Scarab}`

**Parsing:** expects `{ lines: [...] }`; maps `currencyTypeName/chaosEquivalent` and
`name/baseType/chaosValue/divineValue/listingCount/links/variant`. `request()` explicitly **rejects
if the body starts with `<`** ("poe.ninja returned HTML (Cloudflare?)") and handles 429/redirects.

**League resolution — the root problem:**
- League is **never auto-detected**. It flows from `settings.authorization.selected_league`,
  which **defaults to `'Standard'`** (`SettingsService.DEFAULT_SETTINGS`).
- The Settings dropdown is seeded from `DEFAULT_LEAGUES`, which contains **no current challenge
  league** — the user must type the exact live league name by hand.
- There is **no equivalent of POEMCP's `_get_current_league()`** (which scrapes poe.ninja's
  homepage for `/economy/<league>/` and validates it against the API).

**Why it's failing (verifiable from code):**
1. With a stale/blank/`Standard` league, the legacy overview endpoints return either Standard data
   or **empty `lines`** for an unknown league → `buildPriceMap` is empty → every `ItemPricer`
   ninja lookup misses → silent "no price".
2. When poe.ninja serves a **Cloudflare HTML challenge**, `request()` rejects, surfacing as a
   thrown IPC error in `economy:getSnapshot`.
3. No hardcoded *wrong* league names exist beyond the `'Standard'` default — the failure is the
   **missing live-league resolver**, not a baked-in dead league.

**Fix direction (for the MCP, not this repo):** port POEMCP's `_get_current_league()` so the league
is resolved live and validated before fetching; keep VAAL's richer typed snapshot shape.
