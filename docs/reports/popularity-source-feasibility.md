# Report — league-starter popularity sourcing: feasibility probe (READ-ONLY)

**Date:** 2026-06-18 · **League stand-in:** 3.28 Mirage (probing *mechanics*, not 3.29 content) ·
**Status:** 🔵 probe complete — **no scraper/feature committed** (this report is the deliverable).
**Method:** one-shot `curl` reads with a descriptive `User-Agent`
(`poe-oracle-feasibility-probe/0.1 (read-only research; +github…)`), no loops/polling — a faithful proxy
for the MCP node server's single `fetch`. Per [DECISIONS.md](../DECISIONS.md): any source needing
OAuth/auth or a headless browser to yield content is treated as **not cleanly feasible** — noted, not
engineered around.

## The real question

We want the **pre-launch popular-starter** signal (creator picks, available right after a 3.29 reveal,
*before* anyone has characters). The probe asks per source: (i) reachable from node? (ii) structured JSON
/ prose HTML / JS-walled? (iii) **pre-launch creator signal** or only **post-launch player data**?
(iv) rate-limit / ToS posture.

## Per-source findings

| source | reachable (node, 1-shot) | format | signal type & timing | rate-limit / ToS | verdict |
|---|---|---|---|---|---|
| **poe.ninja /poe1/builds** | ✅ `GET /poe1/api/data/build-index-state` → **200 application/json** (10 KB). *(Legacy `/api/data/getindexstate` → **404**, dead — confirms DECISIONS.md.)* | **Structured JSON** — clean | **Post-launch player data.** `total:124484` chars indexed → **≈empty at launch**; answers "live meta," not pre-launch | No robots.txt (404); Cloudflare-cached (`cf-cache: HIT`); public API the page itself calls; **no auth**. Single cached reads fine | **MCP-feed-able — but wrong question** (live meta, not pre-launch) |
| **Reddit league-start megathread** | ❌ `www.reddit.com/*.json` → **403 Blocked** (HTML block page, sets `edgebucket`, `Retry-After: 0`) | Would be JSON via OAuth; **content is unstructured prose** (titles/comments) | Pre-launch hype — but messy; "top builds" from comment text is unreliable | **OAuth required** (post-2023 lockdown) + strict limits → not cleanly feasible per guardrails | **runtime-Claude-only** |
| **Maxroll /poe/build-guides** | ✅ **200 text/html** (405 KB), **server-rendered** — `League Start`×247, `Deadeye`×56, `Necromancer`×41, `Lightning Arrow`/`Spark`/`Ascendant` all in the bytes. Cloudflare, **not** challenged | **Prose HTML** (parseable markup; no JSON contract) | **Pre-launch creator picks — the signal we want** | robots.txt **explicitly `Disallow: /` for `anthropic-ai` + CCBot/Bytespider/Firecrawl/Apify…**; generic `*` *allows* `/poe/build-guides` (only `/planner/*`,`/admin`,`/auth` blocked) | **runtime-Claude-only** (ToS intent is AI-bots-unwelcome; standing feed not ToS-clean; parse target fragile) |
| **Mobalytics /poe/builds** | ⚠️ **200 text/html** (592 KB), partial SSR (`Tier List`,`Deadeye`,`Necromancer`,`RF`,`LA` present) but carries a Cloudflare **`challenge-platform`** marker | Mixed SSR/client; **prose HTML** | Pre-launch creator picks | robots `*: Allow /` (path not disallowed) **but** Cloudflare anti-bot → **intermittent-block risk** | **not viable** as a reliable feed (anti-bot) |
| **YouTube / streamer tier lists** | — *(assessed only, not fetched)* | video/visual; transcripts unreliable | Pre-launch creator picks (strong) | No clean API without a key; tier content is in-video | **runtime-Claude-only** (don't build) |

### Notes on the structured win (poe.ninja)
`build-index-state` returns exactly the archetype signal, e.g.:
```json
{"leagueBuilds":[{"leagueName":"Mirage","leagueUrl":"mirage","total":124484,"statistics":[
  {"class":"Hierophant","skill":"Kinetic Fusillade","percentage":6.26,"trend":-1},
  {"class":"Chieftain","skill":"Righteous Fire","percentage":5.35,"trend":1}, …]}]}
```
`class` (ascendancy) + `skill` + `percentage` + `trend` — deterministic, cacheable, no auth. The one and
only structurally clean source found. Its flaw is **timing**, not format.

## Overall recommendation

**For the *pre-launch* popular-starter question, an MCP-side feed buys nothing over runtime Claude
web-search — keep B3 meta-sourcing as a runtime Claude task (current design).** The two facts that settle
it:

1. The **only** cleanly + ToS-clean + structured source (poe.ninja JSON) carries **post-launch player
   data** — it is structurally ≈empty at the exact pre-launch moment we care about.
2. Every source that carries the **pre-launch creator signal** (Maxroll/Mobalytics tier lists, Reddit,
   YouTube) is either OAuth-walled (Reddit), AI-bot-disallowed / anti-bot-challenged (Maxroll/Mobalytics),
   or keyless+unstructured (YouTube). All are unstructured prose that Claude's reasoning summarizes better
   than a brittle MCP HTML extractor would — and a standing scraper against Maxroll runs counter to its
   robots.txt (`anthropic-ai` explicitly disallowed).

**Optional, separate, genuinely useful (NOT this question):** once a league is a few days live,
`poe.ninja/poe1/api/data/build-index-state` is a clean, structured, cacheable **live-meta** feed worth
wiring as its own deterministic MCP input (single cached read, descriptive UA, honor `cf-cache`). That
would strengthen *mid-league* "what's actually working now" answers — but it does **not** answer
"pre-launch starter picks," so it doesn't change the B3 recommendation above. Flagged for Eric as a
distinct, optional increment.

## ToS / guardrail compliance of this probe
One-shot reads only, descriptive UA, no loops/polling/persistent fetcher, no auth bypassed, no headless
browser, nothing cached to the repo. Reddit's 403 and Maxroll's `anthropic-ai` disallow were **observed
and respected**, not worked around. No scraper or feature code written.
