# Report — data-grounded crafting coverage diff (read-only)

**Date:** 2026-06-14 · **Source:** repoe-fork PoE 1 JSON (the export ORACLE already consumes) ·
**Status:** analysis only — NO model code, no behaviour change.

Settles "are we missing anything?" with data, not memory. Diffs the authoritative PoE 1 crafting
universe against ORACLE's modeled methods. Files present in the export: `mods`, `base_items`,
`item_classes`, `mod_types`, `tags`, `essences`, `fossils`, `crafting_bench_options`, `gems`,
`cluster_jewels` (no separate currency/oils/omens/resonator files — those are items in `base_items`).

## Resolved uncertainties — one-line yes/no (presence in PoE 1 data)

| Entity | In PoE 1 data? | Evidence |
|---|---|---|
| **Omens** | **YES** | 16 "Omen of X" items (StackableCurrency), e.g. Omen of Amelioration/Return/Refreshment |
| **Tempering Orb** | **YES** | `Tempering Orb` [StackableCurrency] |
| **Tailoring Orb** | **YES** | `Tailoring Orb` [StackableCurrency] |
| **Synthesis** | **YES** | domains `synthesis_a`(108)/`synthesis_globals`(65)/`synthesis_bonus`(38); gen-types match |
| **Corruption** | **YES** | `corrupted` generation_type (463); `Vaal Orb` (+ Volatile/Djinn-Touched) |
| **Anointing (oils)** | **YES** | Oils [StackableCurrency] (Clear/Sepia/Amber/…/Tainted/Reflective/Prismatic) |
| **Influence** | **YES** | influence orbs (`Awakener's Orb`, `Shaper's`/`Elder's Exalted Orb`); gated via base influence tags, not a mod implicit_tag |
| **Eldritch (searing/eater)** | **YES** | `searing_exarch_implicit`(1998) + `eater_of_worlds_implicit`(2070) |

**Every suspected entity is real PoE 1.** No contamination among them. (Also present, 3.28-flavoured:
`Foulborn Exalted Orb`, `Veiled Exalted/Chaos Orb`, `Tempering Catalyst`.)

## Coverage table — crafting source/domain → modeled?

ORACLE method set: currency (alt-regal / chaos-spam / exalt-slam), essence, fossil, bench, meta-mods
(multimod / locks / cannot-roll), harvest (+ Rancour).

| Source (gen-type / domain / item) | Count | Modeled? | Note |
|---|---|---|---|
| item-domain `prefix`/`suffix` | 6792 / 5851 | **YES** | the core pool — currency, fossil, harvest, slam all operate here |
| `essence` gen-type / essence-only | 146 | **YES** | essence method |
| `crafted` domain | 1630 | **YES** | bench + meta-mods (multimod / locks / cannot-roll) |
| fossils (`fossils` export) | 25 | **YES** | fossil method (single-socket) |
| `corrupted` gen-type / Vaal Orb | 463 | **NO** | corruption outcomes (Vaal Orb, corrupted implicits) |
| `veiled` + `unveiled` domains / Veiled orbs | 20 + 257 | **NO** | Betrayal unveiling, Aisling, Veiled Chaos/Exalted Orb |
| `enchantment` gen-type | 1635 | **NO** | lab enchants, Tempering Orb, Tailoring Orb |
| oils (anoint → enchant) | — | **NO** | anointing |
| `searing_exarch_implicit` + `eater_of_worlds_implicit` | 1998 + 2070 | **NO** | Eldritch (Ember/Ichor) implicits |
| `synthesis_a`/`globals`/`bonus` domains | 211 | **NO** | synthesised implicits / Synthesiser |
| influence orbs / influence-gated pools | — | **NO** | Awakener's / Shaper's / Elder's / conqueror exalts |
| Catalysts (jewellery quality, tag-weighted) | — | **NO** | quality method |
| `bestiary` gen-type | 24 | **NO** | beastcrafting |
| Resonators (`DelveSocketableCurrency`) | 8 | **PARTIAL** | fossil method exists; multi-socket resonator combos not modeled |
| Omens (16 "Omen of X") | 16 | **NO** | drop/outcome modifiers, not item-mod crafting (different category) |
| `crucible_tree`(2604), `scourge_*`(1297), `expedition_logbook`(21), `talisman`/`tempest`/`torment`/`nemesis`/`bloodlines`, `blight*`, `memory_altar`, `necropolis_*`, `azmeri` | many | **N/A** | league/monster mechanics, not item mod-crafting |
| `unique`(15117), `crucible_unique_tree` | — | **N/A** | unique items, not crafted |
| monster/area/jewel/heist/sentinel/sanctum/tincture/etc. domains | many | **N/A** | not item crafting |

## GAP list — in the data, crafting-relevant, NOT modeled

1. **Corruption** (`corrupted`, 463) — Vaal Orb outcomes + corrupted implicits.
2. **Veiled / unveiling** (`veiled` 20 / `unveiled` 257) — Betrayal, Aisling, Veiled Chaos/Exalted Orb.
3. **Enchantments** (`enchantment`, 1635) — lab enchants, **Tempering Orb**, **Tailoring Orb**.
4. **Anointing** — oils → enchant.
5. **Eldritch implicits** (searing 1998 + eater 2070) — Eldritch Ember/Ichor currency.
6. **Synthesis** (synthesis domains, 211) — synthesised implicits.
7. **Influence** — Awakener's / Shaper's / Elder's Exalted, conqueror exalts; influence-gated pools.
8. **Catalysts** — jewellery quality, tag-weighted.
9. **Beastcrafting** (`bestiary`, 24).
10. **Resonators / multi-fossil combos** (fossil method is single-socket).
11. **Omens** (16) — present but a *different category* (drop/outcome modifiers, not item-mod crafting).

## CONFIRMED-ABSENT — suspected, but NOT in the data

**Empty.** Every entity flagged as uncertain (Omens, Tempering Orb, Tailoring Orb, Synthesis,
Corruption, Anointing, influence, eldritch) **is present** in the PoE 1 export. Nothing suspected was
contamination — so there is nothing to drop from consideration on absence grounds.

## Notes / caveats
- "Modeled?" is about whether ORACLE has a **method** for that source, not whether the mods are loaded
  (all item-domain mods are loaded; the question is the crafting action).
- Influence "modeled? NO" = we don't model the influence-**adding** orbs nor surface influence-gated
  pools as a method; influence mods would appear in `buildSlotPool` only if the base already carries the
  influence tags.
- Counts are mod-entry counts from the live export (2026-06-14), not distinct crafts.
- No prioritization here, per scope — this is the diff. Reprioritization of the roadmap happens next;
  recombinators remains the next actual method build.
