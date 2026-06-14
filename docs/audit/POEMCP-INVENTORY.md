# POEMCP Inventory (read-only reference)

Source: `github.com/shalayiding/POEMCP` → cloned to `docs/audit/reference/POEMCP`.
Python **FastMCP** server (`server.py`), read-only PoE lookups + PoB export parser.
Server registers **13 tools** across player / mods / env / economy / wiki / PoB domains.

**Stack:** `mcp.server.fastmcp.FastMCP`, `httpx`, `beautifulsoup4`. License: none declared in
`pyproject.toml` (treat as read-only reference; lift logic, not files).

**Fragility key:** 🟢 stable (documented API / official JSON / fixed binary format) ·
🟡 semi-stable (API + a small scrape) · 🔴 fragile (HTML scrape — breaks when site markup changes).

---

## Tools

| Tool | Returns | Data source | How it parses | Fragility |
|---|---|---|---|---|
| `search_gem(query)` | Gem name/type/description list + poedb URLs | **poedb.tw** `/us/Gem` | BeautifulSoup over `div.d-flex.border-top.rounded`, `gem_*` CSS classes | 🔴 scrape |
| `get_gem_detail(gem_name)` | Tags, properties, requirements, stats, quality bonus, level-effect table | **poedb.tw** `/us/<Gem_Name>` | BS4 `div.gemPopup`, `div.property`, `div.explicitMod`, level-effect `div.card` table | 🔴 scrape |
| `search_item(query)` | Unique/base item matches by name/keyword | **poedb.tw** (category index pages) | BS4 over category tables; `ITEM_CATEGORIES` slug map | 🔴 scrape |
| `get_item_detail(name)` | Item stats/mods/acquisition | **poedb.tw** item page | BS4 popup/section parse | 🔴 scrape |
| `search_passive(query)` | Matching tree nodes (keystone/notable/mastery/…) by name or stat text | **Official tree JSON** `raw.githubusercontent.com/grindinggear/skilltree-export/master/data.json` | Loads `nodes`, classifies via `isKeystone/isNotable/isMastery/...`, fuzzy stat match | 🟢 official JSON |
| `get_passive_detail(name)` | Node stats / type / id | same tree JSON | id/name lookup over loaded tree | 🟢 official JSON |
| `search_mods(item_type)` | Prefix/suffix pools for a base type | **poedb.tw** (`ITEM_TYPE_SLUGS` → `/us/<Slug>`) | BS4 + regex over mod tables; JSON embedded extraction | 🔴 scrape |
| `env_search(query, category)` | Maps + scarabs by name/keyword | **poedb.tw** `/us/Map`, `/us/Scarab` | BS4 (`scarabs.py`, `maps.py`); fuzzy scoring | 🔴 scrape |
| `env_detail(name)` | Full map/scarab detail (connected maps, boss, effect, limit) | **poedb.tw** | BS4 per-category detail fn | 🔴 scrape |
| `price_check(query, league?, category?)` | Name match → chaos/divine value, listings, 7-day trend, category | **poe.ninja API** `/api/data/currencyoverview` + `/api/data/itemoverview` | JSON `lines`; fuzzy `_match_score`; **`_get_current_league()` auto-detect** | 🟡 API + homepage scrape |
| `currency_overview(league?)` | Top-20 currencies by chaos value | **poe.ninja API** `/api/data/currencyoverview?type=Currency` | JSON `lines`, sort by `chaosEquivalent` | 🟡 API + homepage scrape |
| `fetch_wiki_page(wiki_url)` | Cleaned markdown of useful wiki sections (mechanics/acquisition/recipes), tables→md, noise stripped | **poewiki.net** | BS4 `div.mw-parser-output`; skip nav/refs/version-history; strip hoverbox popups; section walker | 🔴 scrape (but the **noise-stripper is the valuable part**) |
| `parse_pob(code_or_url)` | Markdown build summary: class/level, notes, progression stages, bandit/pantheon, key stats, resistances, defense, charges, skill links, equipped items, keystones/notables | **PoB export** (base64+zlib→XML); URL fetch from **pobb.in**/**pastebin** | `base64.urlsafe_b64decode` → `zlib.decompress` → `xml.etree`; reads pre-computed `<PlayerStat>` values; strips `{tags}` and `^xRRGGBB` color codes | 🟢 fixed format (but **stats are PoB's export-time values, not recalculated**) |

---

## Data-source summary

| Source | Tools | Stability |
|---|---|---|
| **poedb.tw** (HTML scrape) | gems, items, mods, maps, scarabs (7 tools) | 🔴 Fragile — the bulk of POEMCP. Breaks on poedb markup changes. |
| **grindinggear/skilltree-export `data.json`** | passives (2 tools) | 🟢 Official GGG tree export on GitHub. |
| **poe.ninja API** | price_check, currency_overview | 🟡 Same legacy endpoints as VAAL, **plus live league auto-detect**. |
| **poewiki.net** (HTML scrape) | fetch_wiki_page | 🔴 Fragile, but the section/noise stripper is reusable. |
| **PoB export format** | parse_pob | 🟢 Stable base64+zlib+XML; no recalculation engine. |

---

## Pieces worth lifting

1. **`_get_current_league()` (economy/pricing.py)** — scrapes poe.ninja homepage for
   `/(economy|challenge)/<league>` slugs, capitalizes, and **validates each candidate has data via
   the API** before caching (1 h TTL). This is the exact fix for VAAL's broken economy league
   resolution. **PORT.**
2. **`parse_pob` (player/pob.py)** — full PoB export → structured summary: base64+zlib decode,
   active SkillSet/Spec/ItemSet selection, `{tag}`/color-code stripping, per-item text parse
   (`Implicits: N` grammar), keystone/notable resolution against the tree JSON, progression-stage
   grouping by `{N}` title tags. **PORT** (a great no-engine fallback when the PoB Lua bridge is
   off). Note: stats come from PoB's embedded `<PlayerStat>`, so it cannot do what-if recalculation.
3. **`fetch_wiki_page` noise stripper (wiki.py)** — section whitelist/blacklist, hoverbox-popup
   removal, table→markdown, heading-level-aware section walker. **PORT** for any wiki-mechanics tool.
4. **poedb coverage** — maps + scarabs + per-base mod pools + gem level-effect tables. VAAL has none
   of the maps/scarabs/gem-detail coverage. **REFERENCE** (use the slug maps + selectors as a guide;
   prefer RePoE/official data where it exists, scrape poedb only for poedb-only fields).

## Caveats
- Almost everything except passives/economy/PoB is a **poedb HTML scrape** → fragile by design.
- `price_check`/`currency_overview` rely on the **same legacy poe.ninja endpoints VAAL uses** — they
  work here only because of the live-league resolver. Those endpoints are themselves the long-term
  fragility risk for both projects.
