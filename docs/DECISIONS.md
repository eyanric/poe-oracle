# Decisions carried forward

Context that isn't derivable from the code. Read before adding features.

## Scope & ToS boundary (non-negotiable)
- **Analysis / information only.** Everything is read-only: public game data, prices, trade
  listings, and parsing builds the user pastes. Tools *inform* the player's manual decisions.
- **GGG's rule:** a tool may inform you, never act for you. Any feature touching the game must be
  **manually invoked** — no timers, no reacting to file/screen changes, no auto-pollers that act.
  The reference design is **Awakened PoE Trade**: manual, clipboard-triggered, public-data-driven.
  Litmus test for any feature: *"would APT's design pass this?"*
- **Out of scope, permanently:** input automation, mouse/keyboard simulation, screen-coordinate
  clicking/calibration, crafting/alt-spam execution loops, hotkey-driven automation, any
  "ban-resistance"/detection-evasion logic. None of this is ported from VAAL, built, or "hardened."

## Licensing — MIT / clean-room
- This repo is MIT. **No GPL code is imported.** RePoE / PyPoE are GPL-3.0 → we consume their JSON
  **data exports** (data, not code). Path of Building math is **reimplemented clean-room** from
  mechanics + data exports; PoB source is never lifted.

## Provenance / "leave behind"
- **VAAL** (the old GitHub-Copilot Electron app, `~/GitHub/vaal`) is a **read-only reference**, kept
  in a separate checkout. We may read it to understand the read-only services worth reimplementing
  (poe.ninja client, trade pricing, mod-pool reader), then reimplement clean here. Never import it,
  never depend on it, never copy its execution layer.
- **The "two poe-mcps" trap:** the Python `shalayiding/POEMCP` is a **dead path** (its economy died
  with the legacy poe.ninja `/api/data/*` endpoints). This repo is the live TypeScript line. Don't
  revive the Python one.

## Practical guardrails
- Respect official trade API rate limits — cache aggressively, batch, back off. Over-polling gets
  you throttled/IP-flagged even when ToS-clean.
- **Never trust an LLM-produced price/EV blind.** Validate every spend-worthy number against live
  trade before acting; validation is built in, not bolted on (see `docs/repoe-validation.md`).

## Data sources (live as of 2026-06)
- Economy: **poe.watch** (`api.poe.watch`) + **poe.ninja** new PoE1 stash namespace. Legacy
  poe.ninja `/api/data/*overview` is dead.
- Game data: **repoe-fork.github.io** JSON exports (maintained fork; NOT legacy brather1ng/RePoE).
- Live trade: official `pathofexile.com/api/trade/*` (search/fetch/exchange), rate-limit-honoured.
- Patch currency at bootstrap: **3.28 "Mirage"**; next league **3.29 → 2026-07-24**.
