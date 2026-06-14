# poe-oracle

A **read-only, ToS-clean Path of Exile 1 AI copilot** — an MCP server giving an AI assistant
(Claude Desktop / Claude Code) a live information & analysis edge for the **economy** and **build
theorycrafting**. It *informs* your manual decisions; it never acts in-game. See
[`docs/DECISIONS.md`](docs/DECISIONS.md) for the scope/ToS/licensing boundary.

> Clean-room rebuild of the data/analysis half of the old VAAL Electron app, with the automation
> layer left behind entirely. MIT licensed; no GPL code lifted.

## Architecture (dependencies point downward only)

```
tools/      MCP tool wrappers (the only zod + MCP-SDK layer) — thin, compose services
  ↓
services/   game logic: economy providers, league resolver, live trade, appraisal,
            item parsing, mod-pool/spawn-weights. Stateless, typed, knows nothing about MCP.
  ↓
data/       raw cached fetchers: repoe-fork JSON exports, GGG tree export, fetchJson primitive.
```

The downward rule is enforced by ESLint (`no-restricted-imports` per layer): `services/` may not
import `tools/`; `data/` may not import `services/` or `tools/`.

## Tools (CORE — always on, zero native deps)

| Tool | What |
|---|---|
| `currency_overview` | Top currency rates in chaos for the current league |
| `price_check` | Name → chaos/divine value, listing count, source, low-confidence flag |
| `price_check_item` | **Paste an in-game item** → parsed summary + live-trade flip verdict |
| `appraise` | Reconcile poe.watch + poe.ninja against a bounded LIVE trade sample → freshness-gated actionable margin |
| `watch` | On-demand appraisal of a small list, paced by the trade rate limiter |

All default `league` to the resolved current challenge league (Trade-API primary + poe.ninja
`index-state` fallback; never silently falls back to Standard).

An **OPTIONAL** tier (gated by `POB_LUA_ENABLED`) is reserved for the future clean-room PoB calc
engine; it currently registers nothing.

## Develop

```bash
npm install
npm run dev            # tsx watch (stdio transport by default)
npm run build          # tsup → dist/index.js
npm run check          # typecheck + lint + test (quality gate)
npm run validate:repoe # live RePoE data-source validation (see docs/repoe-validation.md)
```

Manual live smoke tests: `node acceptance.mjs`, `node appraise-acceptance.mjs`, `node http-acceptance.mjs`.

## Connect to Claude (stdio)

```json
{
  "mcpServers": {
    "poe": { "command": "node", "args": ["<abs-path>/poe-oracle/dist/index.js"] }
  }
}
```

`MCP_TRANSPORT=http` runs a streamable-HTTP server (`POST /mcp`, `GET /health`) for a remote
connector instead. `POESESSID` (env) is sent to the trade API when present.

## Roadmap

1. **Track A — `calc_craft_cost`**: RePoE spawn-weight model → expected attempts, live-priced orb
   breakdown, chaos+divine total, craft-vs-buy verdict. (Data source validated:
   [`docs/repoe-validation.md`](docs/repoe-validation.md).)
2. **Track B — league-start intelligence** for 3.29 (2026-07-24): budget-aware starter + early
   farm/flip plan from patch notes + meta.
3. Later: `parse_pob` + passive-tree analysis; clean-room PoB calc engine.
