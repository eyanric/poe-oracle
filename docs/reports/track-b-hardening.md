# Report — Track B hardening (league-start intel, 3.28 dry-run → 3.29-ready)

**Date:** 2026-06-16 · **Status:** 🟢 B1 (patch-note extraction) hardened against LIVE forum HTML; rehearsal green on real 3.28 sources. B3 build-popularity: flagged (decision for Eric). Gates green (typecheck ✓ · lint ✓ · 421 tests ✓ · build ✓ · **crafting parity untouched**).

The deadline-bound work. 3.29 intel doesn't exist until the reveal (~Jul 16); what we harden now is the
**extraction pipeline**, rehearsed against 3.28 launch-era data. Formats are stable league-to-league, so a
clean live-3.28 run is strong evidence it'll work on reveal day.

## Step 1 — Diagnosis of the skeleton (as found)

| Phase | Files | Input | Real fetch vs stub | Verdict |
|---|---|---|---|---|
| **B1 patch notes** | `data/patchNotes.ts`, `services/patchNotesParser.ts`, tool `get_patch_notes` | GGG forum thread HTML → structured changes | live fetch path existed **but the dry-run parsed a hand-cleaned plain-text fixture**; default tool UA | **gap: degraded on real forum HTML** |
| **B2 build cost** | `services/buildCost.ts`, tool `estimate_build_cost` | unique/gear list → tiered chaos/divine | **LIVE** (real economy snapshot) | fine |
| **B3 plan synthesis** | `services/leagueStartPlan.ts`, tool `league_start_plan_contract` | patch signals + meta → league-start plan | **build-popularity hand-filled in the dry-run** | by design: meta = runtime reasoning (see below) |

"Dry-run green" exercised **plumbing on a clean fixture**, not live extraction. The two real gaps: B1's live-HTML
robustness, and B3's build-popularity source.

## Step 2 — Hardening landed (B1)

Parsing the **live** GGG forum HTML (browser UA, 168 KB) through the old parser produced **224 junk `-` sections
and currency = 0** — the Table-of-Contents `<ul>` and multi-line `<li>`s shattered the "non-bullet line = header"
heuristic, and the live currency header is **"Item Changes"** (the fixture said "Currency"). Fixes:

- **`<h*>` headings as section boundaries.** `stripHtml` sentinel-marks real headings; when present the parser
  uses *only* those as boundaries and treats everything else as content. Plain-text fixtures (no headings) keep
  the old heuristic **byte-for-byte** — existing tests unchanged.
- **`sectionCategory`: "Item Changes" → currency** (live naming).
- **Browser UA on `getPatchNotesRaw`** — the historical 403 wall (same win proven on poewiki Cargo). Still
  overridable via `opts.headers`. (Note: GGG's forum currently serves 200 to the default UA too — but the
  browser UA is the documented mitigation if it re-blocks at reveal-day load.)

**Result (live 3.28):** `224 junk sections / currency 0` → **`33 clean sections / currency 36`** (skills 54,
uniques 22, mechanics 274, buffs 150, nerfs 129), zero junk headers. Regression net: +3 parser tests for the
HTML path (ToC, multi-line `<li>`, `<h3>Item Changes`).

## Step 3 — Live 3.28 rehearsal (`npm run validate:track-b`)

End-to-end on **real** sources (not the fixture): B1 live-fetches + parses the forum HTML, B2 prices two builds
live, B3 assembles a contract-valid plan whose build candidates are seeded from the **real** patch signals + live
cost, each line **source- and recency-labelled**. Flag-don't-invent: a dead/empty source flags "missing/
low-confidence", never a fabricated meta call. Facts only — summarized, no verbatim patch prose.

| Check | Result |
|---|---|
| B1 live fetch + parse | ✓ 168 KB forum HTML → Mirage 3.28.0, 33 clean sections |
| B1 categories incl. currency | ✓ all > 0 (currency now captured from "Item Changes") |
| B2 build cost | ✓ starter + endgame priced & tiered (live economy) |
| B3 plan contract | ✓ valid; sources + recency labelled |
| Flag-don't-invent | dead source → "missing/low-confidence" branch |
| Crafting parity | untouched (Track B is separate from the engine) |

## B3 build-popularity — decision for Eric

The 3.28 dry-run **hand-filled** the build list, and that's the architecture: ORACLE's deterministic
contribution is **structured patch changes (B1)** + **live build costs (B2)**; the **build-popularity / meta
judgement is Claude's runtime web-search** (Maxroll / Mobalytics / forum & video roundups). That's deliberate —
poe.ninja/builds has **no usable public API** (`getbuildoverview` 404s, confirmed), and an MCP scraper of guide
aggregators would be brittle and rot between leagues, whereas a live web-search at reveal day is robust.

**So I did not ship a scraper** (flag-don't-invent: a fragile extractor that mislabels the meta is worse than an
honest runtime slot). `validate:track-b` now makes that slot **explicit and sourced** in `plan.sources`.

**Your call:** keep build-popularity as the runtime-reasoning slot (recommended), **or** you want a best-effort
MCP extractor that fetches a configured aggregator (browser UA) and ranks skill/ascendancy **name mentions**
against the real gem list (frequency, not a meta call) — doable but fragile, and I'd flag its output low-confidence.

## 3.29 RE-GATE CHECKLIST (launch-day — tracked so it isn't missed)

Can't be done until 3.29's content is known; flip when it is:

1. **Register the 3.29 source** in `PATCH_NOTE_SOURCES` (one entry: version/league/forum URL) → the hardened
   pipeline runs unchanged. Re-run `validate:track-b` on the real 3.29 notes.
2. **Recombinators:** if 3.29 includes them, add the league to `recombine.ts`'s `leagues`.
3. **Mirage content rotating out:** re-gate Crystallised Rancour reforges + Sinistral/Dextral catalysts when
   Mirage ends.

## Flags / next

- The **minion PoB fixture** remains a trivial rider (separate, on request).
- No automation. Track B stays Claude-orchestrated (MCP supplies deterministic inputs; Claude reasons).
