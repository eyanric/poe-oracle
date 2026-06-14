# League-start intelligence — runtime workflow (Track B)

The runbook Claude executes to produce a league-start plan. This is a **Claude-orchestrated
workflow**, not one magic tool: the MCP supplies deterministic inputs; Claude does the meta
reasoning. ToS-clean (public patch notes + public economy data); analysis-only; manual-invoke.

**Deadline:** 3.29 reveals **July 16, 2026**, launches **July 24**. This skeleton is dry-run-green
on 3.28 now (see [league-start-dryrun-3.28.md](./league-start-dryrun-3.28.md)). On reveal day the
window is just: add the 3.29 source → re-run → refine.

## Split of labor

| Concern | Owner |
|---|---|
| Patch notes → structured categories | **MCP** (`get_patch_notes`, B1) |
| Build gear list → priced budget tier | **MCP** (`estimate_build_cost`, B2) |
| Plan output contract / validation | **MCP** (`league_start_plan_contract`, B3) |
| Meta + build-popularity feeds (poe.ninja/builds, Maxroll, reddit, streamers) | **Claude, web search** (deliberately NOT in the MCP) |
| Synthesis / reasoning / confidence calls | **Claude, in conversation** |

## Step order (the runbook)

1. **Pull structured patch notes** — `get_patch_notes` with the version key (e.g. `3.29`) or the
   forum URL. Read the `skills` / `uniques` / `mechanics` / `buffs` / `nerfs` / `currency` buckets;
   the buff/nerf split is a heuristic — confirm against the raw section text before leaning on it.
   Identify: what got buffed (build enablers), what got nerfed (avoid), new skills/uniques (potential
   spikes), and currency/economy shifts (flip signals).

2. **Web-search the live meta** (Claude, not MCP) — current build-popularity and league-start guides:
   poe.ninja/builds (once data exists), Maxroll/Mobalytics tier lists, subreddit league-start threads,
   notable streamers' starters. Cross-reference against step 1 (does the meta line up with the buffs?).

3. **Cost-estimate candidates** — for each promising build, build a gear list and call
   `estimate_build_cost` to get a budget tier (starter / functional / aspirational) in chaos + divine.
   Rares aren't indexed → unpriced slots make the total a **lower bound** (flagged); prefer the divine
   figure. Re-check spend-worthy numbers against live trade.

4. **Compose the plan against the contract** — `league_start_plan_contract` returns the blank shape.
   Fill `viableBuilds` (with the step-3 tiers), `earlySpikes` (item/mechanic + reasoning + confidence),
   `farmFlipPriorities` (0–48h / 48–72h). Cite `sources`. Keep the mandatory predictive caveat. The
   contract validator (`validateLeagueStartPlan`) enforces required sections + the caveat.

5. **Stamp + caveat** — league, version, data-as-of date. State plainly that predictions ride on the
   reasoning + live feeds, not the pipeline; prices/meta move fast in the first days — directional only.

## What this pipeline guarantees vs not

- **Guarantees (plumbing):** notes are fetched + structured losslessly; build costs are real, live,
  and divine-denominated with confidence flags; the plan has a validated shape.
- **Does NOT guarantee (reasoning):** that the flagged builds/items are actually the right calls —
  that depends on step 2/5 judgment and is only testable against real post-launch data.
