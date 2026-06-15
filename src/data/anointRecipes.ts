/**
 * data — Blight oils + amulet anoint recipes (notable → fixed 3-oil combination).
 *
 * DIAGNOSIS (docs/reports/anoint-producer.md): the notable→oil recipe table is NOT in any
 * Code-fetchable export. Checked: PoB `pob-data/poe1/Misc.json` (monster/game constants only),
 * the rest of pob-data/poe1 (only Costs.json + ClusterJewels.json exist; Oils/Anoints/Notables
 * 404), the main repoe-fork base (blight_crafting_recipes/oils/anoints/enchantments all 404 —
 * only cluster_jewel_notables.json, which is cluster-jewel data, not amulet anoints), and the
 * PoB community repo (no oil/anoint/blight data file — PoB computes anoints in code). It is Blight
 * crafting data (`BlightCraftingRecipes`), not exported here.
 *
 * So this is a hand-sourced SEED, NOT generated. Anoints are DETERMINISTIC — a wrong oil triple is a
 * wrong deterministic answer — so entries are added only when verified against the live game, and
 * the producer treats them as low-confidence. Populate the full ~455-notable amulet table from poedb
 * (Oil) and verify a sample. The producer also accepts an explicit 3-oil list, so any anoint can be
 * costed without a table entry (the table only saves the notable→oils lookup).
 *
 * Schema: { [notableName]: [Oil, Oil, Oil] }  — Oil names without " Oil" (see OIL_TIERS).
 *   Amulet anoints only. Ring anoints (Blight-ravaged) and cluster-jewel anoints (1 oil) are separate
 *   sets — flagged, not modelled here.
 */

/** Oil tiers, cheapest → priciest (3 of a tier vendor up to 1 of the next). */
export const OIL_TIERS = [
  'Clear', 'Sepia', 'Amber', 'Verdant', 'Teal', 'Azure', 'Indigo',
  'Violet', 'Crimson', 'Black', 'Opalescent', 'Silver', 'Golden',
] as const
export type Oil = (typeof OIL_TIERS)[number]

export const ANOINT_RECIPES: Record<string, [Oil, Oil, Oil]> = {
  'Whispers of Doom': ['Golden', 'Golden', 'Golden'], // verified: +1 curse limit (the iconic anoint)
}

/** Is a notable in the (seeded) amulet anoint table? */
export const isAnointableNotable = (notable: string): boolean => notable in ANOINT_RECIPES
