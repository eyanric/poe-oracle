# ORACLE — Method Roadmap (data-grounded, prioritized)

> Canonical method roadmap (2026-06-14). **Supersedes** the priority order in the earlier audit/roadmap.
> Basis: the read-only coverage diff vs repoe-fork PoE 1 JSON ([coverage-diff.md](reports/coverage-diff.md)) —
> an authoritative 11-item gap list — weighted by: determinism/profit relevance · economy coverage ·
> interface fit (which arity it stress-tests) · persistence to 3.29 (core > Mirage-only) · solver dependencies.

## Built (6)
currency (alt-regal / chaos / exalt-slam) · essence · fossil (single-socket) · bench · meta-mods
(multimod / locks / cannot-roll) · harvest (+ Rancour, league-gated).

## The arity ladder (order is partly interface-driven, not just coverage)
The method interface is proven shape by shape; later methods reuse earlier plumbing:
- **arity-1** (single-item transform): most methods. Proven by Harvest.
- **arity-2** (two-item combine): **Recombinators** prove it — and the same plumbing carries
  **Awakener's Orb** (merge two influences) and **Synthesis** (fuse fractured items). So recombinators are
  worth building as the proving ground *even if the mechanic rotates out of 3.29* — the arity-2 capability transfers.
- **arity-3 / resource-conditioned**: **Memory strands** prove the depleting-resource shape.

## Build order

**Next (interface, locked):**
0. **Recombinators** — arity-2 stress test. Deep-dive on combine modes precedes the build prompt.

**Tier 1 — core, high-coverage, mostly arity-1, persists to 3.29 (most coverage fast):**
1. **Eldritch implicits** (Exarch/Eater embers & ichors; eldritch annul targeting) — ~4000 implicit entries;
   on nearly every endgame rare. Deterministic-ish tiers. Huge coverage.
2. **Influence crafting** (Shaper/Elder/conqueror exalts; **Awakener's Orb** = arity-2 reuse; Maven elevate) —
   most high-end rares are influenced. Surfaces influence-gated pools as a method.
3. **Catalysts** (jewellery quality, tag-weighted) — cheap, deterministic, every ring/amulet/belt craft.
   Easy win. (+ Mirage Sinistral/Dextral, league-gated.)
4. **Anointing** (oils → notable/enchant; amulets, rings, blight uniques, Mirage Cord Belt) — deterministic,
   oils live-priced, trivial to model. Easy win.

**Tier 2 — high value, newer shapes / more complex:**
5. **Veiled / Aisling** (Betrayal unveil 1-of-3; Aisling T4 remove-add-veiled; Veiled Chaos/Exalted Orb) —
   top deterministic tool; arity-1.
6. **Synthesis** (synthesised implicits; fuse fractured items) — reuses arity-2 plumbing from recombinators.
7. **Memory strands** + **Hinekora's Lock** — arity-3 resource shape + the variance-killer foresight mechanic.

**Tier 3 — situational / high-variance / refinements:**
8. **Corruption** (Vaal Orb, temple double-corrupt, Mirage Volatile Vaal) — terminal high-variance; model as a
   brick-engine terminal node.
9. **Beastcrafting** (imprint → recoverability feeds the risk engine; aspects; split).
10. **Resonator multi-fossil combos** — refinement *inside* the fossil method (2–4 sockets change the weight
    math), not a new method.
11. **Lab enchants + Tempering/Tailoring orbs** (enchantment gen-type, 1635) — situational gamble pools.

**Then:**
12. **Path solver** — searches method sequences for the cheapest risk-adjusted path. Gated on enough methods
    being on the interface; Tiers 1–2 get us there. The differentiator.

## Resolved / dropped
- **Omens** — present in PoE 1 data but the **utility/defensive** kind (Amelioration/Return/Refreshment), not
  crafting-targeting. **Dropped from the crafting roadmap** (pending confirmation no Sinistral/Dextral
  *crafting* omen exists in 3.28; the targeting omens are PoE 2).
- **Confirmed-absent:** none — nothing suspected was contamination.

## Re-opens / flags
- **Foulborn Exalted Orb** — a Mirage-only crafting currency (the diff caught it); Foulborn has a craft
  dimension beyond the unique variant. League-gated, dies at 3.29 → low priority, but no longer "not a craft."
- **N/A by design:** crucible/scourge/expedition-logbook/talisman/blight/necropolis/azmeri/heist/sanctum/etc.
  — league or monster mechanics, not item mod-crafting. (Several are legacy/removed anyway.)

## Persistence note for the 3.29 edge
Mirage-only (dies July 24): Rancour (built, gated), Foulborn orb, Volatile Vaal, Refracting Fog, Mirage
catalysts. Everything in Tiers 1–2 is core and persists — which is why the order favours them over the
Mirage-specific items for league-start readiness.
