/**
 * data layer — Harvest craft set + lifeforce mechanics (CURRENT 3.28 iteration).
 *
 * ⚠ FRESHNESS — Harvest is the most version-volatile method. The reforge/augment SET + amounts are
 * now confirmed against poewiki Cargo `harvest_crafting_options` (browser-UA fetch, 2026-06-16 sweep —
 * see docs/reports/validation-sweep.md). What it reflects:
 *   - Current iteration = spend coloured Lifeforce (Vivid/Primal/Wild + Sacred) on recipes at the
 *     Sacred Grove / Horticrafting station. The old "reforge keeping prefixes/suffixes" crafts are GONE;
 *     the forcing craft is "add a [tag] mod and remove a random other".
 *   - Lifeforce colour → mod-tag mapping: CONFIRMED against the Cargo per-craft colour costs.
 *   - Per-craft lifeforce AMOUNTS: now CONFIRMED from Cargo (reforge 50/75/100/150 by tag; augment
 *     15000/17500/20000 + 1 Sacred). Lifeforce is live-priceable (poe.ninja) — amounts × live price flow
 *     through economy. The standalone targeted "remove a [tag] mod" craft no longer exists (gone from the
 *     game; only the random removal bundled into the add/remove augment remains).
 *
 * Consume DATA (game facts), not GPL code. Pure module (static tables).
 */

export type LifeforceColour = 'Vivid' | 'Primal' | 'Wild' | 'Sacred'
export type HarvestCraftKind = 'reforge' | 'augment'

/** Lifeforce item names as they appear in the economy (poe.ninja / poe.watch). */
export const LIFEFORCE_ITEM: Record<LifeforceColour, string> = {
  Vivid: 'Vivid Crystallised Lifeforce',
  Primal: 'Primal Crystallised Lifeforce',
  Wild: 'Wild Crystallised Lifeforce',
  Sacred: 'Sacred Crystallised Lifeforce',
}

/** Crystallised Rancour — Mirage-only lifeforce (drops from Corpse-Grown monsters in Harvest-in-Mirage). */
export const RANCOUR_ITEM = 'Crystallised Rancour'
export const MIRAGE_LEAGUE = 'Mirage'

/**
 * Mod-tag → lifeforce colour (Maxroll 3.28 reforge table — authoritative):
 *   Wild  → Fire, Attack, Life
 *   Vivid → Cold, Physical, Chaos, Speed
 *   Primal→ Lightning, Defence, Caster, Critical
 */
export const LIFEFORCE_BY_TAG: Record<string, LifeforceColour> = {
  fire: 'Wild', attack: 'Wild', life: 'Wild',
  cold: 'Vivid', physical: 'Vivid', chaos: 'Vivid', speed: 'Vivid',
  lightning: 'Primal', defence: 'Primal', caster: 'Primal', critical: 'Primal',
}

/** Harvest tag → the mod `implicit_tags` token used to match the mod pool (heuristic). */
export const HARVEST_TAG_TO_MODTAG: Record<string, string> = {
  fire: 'fire', cold: 'cold', lightning: 'lightning', chaos: 'chaos',
  physical: 'physical', life: 'life', attack: 'attack', caster: 'caster',
  defence: 'defences', critical: 'critical', speed: 'speed',
  // Crystallised Rancour (Mirage-only) reforge tags:
  minion: 'minion', attribute: 'attribute', mana: 'mana',
}

export interface HarvestCraft {
  kind: HarvestCraftKind
  tag: string
  colour: LifeforceColour
  amount: number
  /** Sacred Lifeforce also required (the high-end forcing crafts). */
  sacred?: number
  /** Crystallised Rancour also required (Mirage-only reforges: minion/attribute/mana). */
  rancour?: number
  /** Restricts the craft to a league (via league-availability gating). Omitted ⇒ core. */
  league?: string
  /** 'confirmed' = transcribed verbatim from a current source; 'low' = representative, verify. */
  costConfidence: 'confirmed' | 'low'
}

/**
 * Crystallised Rancour reforges (Mirage-only). Cost: N regular Lifeforce + M Rancour.
 * Sourced from a single community guide (u4n, 2026-06-14) — UNVERIFIED vs in-game ⇒ low-confidence.
 */
const RANCOUR_REFORGE: Record<string, { colour: LifeforceColour; amount: number; rancour: number }> = {
  minion: { colour: 'Primal', amount: 200, rancour: 3 },
  attribute: { colour: 'Vivid', amount: 200, rancour: 2 },
  mana: { colour: 'Primal', amount: 200, rancour: 2 },
}
export const RANCOUR_TAGS = Object.keys(RANCOUR_REFORGE)

const colourOf = (tag: string): LifeforceColour => LIFEFORCE_BY_TAG[tag] ?? 'Wild'

// Reforge-with-[tag]: reroll all mods, ≥1 guaranteed of [tag]. Cheap.
// ALL amounts confirmed from poewiki Cargo `harvest_crafting_options` (2026-06-16).
const REFORGE_AMOUNT: Record<string, number> = {
  fire: 50, cold: 50, lightning: 50, physical: 50,
  attack: 75, life: 75, caster: 75, defence: 75,
  chaos: 100,
  critical: 150, speed: 150,
}
// Add-a-[tag]-and-remove-a-random-other (the forcing/augment craft): N colour + 1 Sacred.
// ALL amounts confirmed from poewiki Cargo `harvest_crafting_options` (2026-06-16).
const AUGMENT_AMOUNT: Record<string, number> = {
  fire: 15000, cold: 15000, lightning: 15000, physical: 15000,
  attack: 17500, life: 17500, caster: 17500, defence: 17500, chaos: 17500,
  critical: 20000, speed: 20000,
}

export const HARVEST_TAGS = Object.keys(HARVEST_TAG_TO_MODTAG)

/** Look up the craft definition for (kind, tag), or null if the tag isn't Harvest-craftable. */
export function harvestCraft(kind: HarvestCraftKind, tag: string): HarvestCraft | null {
  const t = tag.toLowerCase()
  if (!(t in HARVEST_TAG_TO_MODTAG)) return null
  // Rancour reforges (Mirage-only): minion / attribute / mana — reforge only.
  if (t in RANCOUR_REFORGE) {
    if (kind !== 'reforge') return null
    const r = RANCOUR_REFORGE[t]
    // amounts confirmed from Cargo (vivid/primal 200 + 2–3 Rancour); availability is Mirage-gated.
    return { kind, tag: t, colour: r.colour, amount: r.amount, rancour: r.rancour, league: MIRAGE_LEAGUE, costConfidence: 'confirmed' }
  }
  const colour = colourOf(t)
  if (kind === 'reforge') {
    const amount = REFORGE_AMOUNT[t]
    return { kind, tag: t, colour, amount: amount ?? 75, costConfidence: amount != null ? 'confirmed' : 'low' }
  }
  // augment = add-a-[tag]-and-remove-a-random-other (the only forcing craft; standalone targeted
  // "remove a [tag] mod" no longer exists in PoE — removal is only the random one bundled here).
  const amount = AUGMENT_AMOUNT[t]
  return { kind, tag: t, colour, amount: amount ?? 17500, sacred: 1, costConfidence: amount != null ? 'confirmed' : 'low' }
}

export const HARVEST_PROVENANCE =
  'Confirmed 2026-06-16 against poewiki Cargo harvest_crafting_options (validation sweep). ' +
  'Colour→tag mapping confirmed; reforge amounts fire/cold/lightning/physical(50), attack/life/caster/' +
  'defence(75), chaos(100), critical/speed(150); augment fire/cold/lightning/physical(15000), attack/life/' +
  'caster/defence/chaos(17500), critical/speed(20000)+1 Sacred — all Cargo-confirmed. No "reforge keeping ' +
  'prefixes/suffixes" (removed). Crystallised Rancour (Mirage-only) reforges minion(200 Primal+3)/' +
  'attribute(200 Vivid+2)/mana(200 Primal+2) — amounts Cargo-confirmed; availability Mirage-gated. ' +
  'Standalone targeted "remove [tag]" craft removed from the game (only the augment\'s random removal remains).'
