/**
 * gen-anoints — regenerate data/anointRecipes.ts from the poewiki Cargo data. Run with tsx.
 *
 *   npm run gen:anoints            # fetch fresh (browser UA + polite delay), emit the .ts
 *   npm run gen:anoints -- --cache # reuse the local raw-pull cache (scripts/.cache, gitignored)
 *
 * The amulet anoint recipes (notable → fixed 3 oils) are NOT in any Code-fetchable game export
 * (diagnosis: docs/reports/anoint-producer.md). The authoritative, current, structured source is the
 * poewiki `blight_crafting_recipes` Cargo table. This fetches it via Special:CargoExport (JSON, not
 * HTML scraping), joins the notable name + the 3 oil components, validates, and emits the seam file.
 * Deterministic recipes — a wrong oil triple is a wrong answer — so oils are resolved from the data
 * (the `items` table), never assumed from tier order, and the emit asserts before writing.
 *
 * This is the per-league refresh mechanism: re-run after a patch, commit the regenerated .ts.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'data', 'anointRecipes.ts')
const CACHE_DIR = join(HERE, '.cache')
const USE_CACHE = process.argv.includes('--cache')
const SOURCE = 'https://www.poewiki.net/wiki/Blight#Anointment (Cargo: blight_crafting_recipes)'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const EXPORT = 'https://www.poewiki.net/index.php?title=Special:CargoExport'
const DELAY_MS = 400
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The 13 standard oils (Clear → Golden), fixed order. Prismatic is an anoint-only exclusive that
// also appears as a recipe component — kept separate so OIL_TIERS stays the canonical 13.
const OIL_TIERS = ['Clear', 'Sepia', 'Amber', 'Verdant', 'Teal', 'Azure', 'Indigo', 'Violet', 'Crimson', 'Black', 'Opalescent', 'Silver', 'Golden']
const ANOINT_ONLY_OILS = ['Prismatic']
const OIL_ORDER = [...OIL_TIERS, ...ANOINT_ONLY_OILS]

/** Paged Cargo export (browser UA + polite delay), with a local raw-pull cache. */
async function cargo(name, params) {
  if (USE_CACHE) {
    const f = join(CACHE_DIR, `${name}.json`)
    if (existsSync(f)) { console.log(`  (cache) ${name}`); return JSON.parse(readFileSync(f, 'utf8')) }
  }
  const out = []
  const LIMIT = 1000
  for (let offset = 0; ; offset += LIMIT) {
    const url = `${EXPORT}&${params}&format=json&limit=${LIMIT}&offset=${offset}`
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HTTP ${res.status} from poewiki Cargo (browser UA WAS used) for ${name} — ${body.slice(0, 200)}\n` +
        'If this is a 403/429, STOP and report: the browser-UA hypothesis failed on this machine. Do not fabricate recipes.')
    }
    const page = JSON.parse(await res.text())
    out.push(...page)
    if (page.length < LIMIT) break
    await sleep(DELAY_MS)
  }
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(join(CACHE_DIR, `${name}.json`), JSON.stringify(out))
  return out
}

console.log(`=== gen-anoints (${USE_CACHE ? 'cache' : 'live fetch, browser UA'}) ===`)

// 1) amulet recipes → notable name (JOIN blight_crafting_recipes → passive_skills)
const recipes = await cargo('recipes',
  'tables=blight_crafting_recipes,passive_skills' +
  '&join_on=' + encodeURIComponent('blight_crafting_recipes.passive_id=passive_skills.id') +
  '&fields=' + encodeURIComponent('blight_crafting_recipes.id=rid,passive_skills.name=notable') +
  '&where=' + encodeURIComponent('blight_crafting_recipes.type="UniqueOrAmulet"'))
await sleep(DELAY_MS)
// 2) recipe → oil item ids (ordered)
const recipeItems = await cargo('recipe_items',
  'tables=blight_crafting_recipes_items&fields=' + encodeURIComponent('recipe_id=rid,ordinal,item_id=item'))
await sleep(DELAY_MS)
// 3) oil item id → display name (authoritative — never assume Mushrune<N> = Nth tier)
const oilRows = await cargo('oils',
  'tables=items&fields=' + encodeURIComponent('name,metadata_id=mid') + '&where=' + encodeURIComponent('name LIKE "%Oil"'))

const oilName = new Map() // metadata id → "Clear" (strip " Oil")
for (const o of oilRows) if (o.mid && /\sOil$/.test(o.name)) oilName.set(o.mid, o.name.replace(/\sOil$/, ''))

// group oils by recipe id, ordered by ordinal
const oilsByRecipe = new Map()
for (const it of recipeItems) {
  if (!oilsByRecipe.has(it.rid)) oilsByRecipe.set(it.rid, [])
  oilsByRecipe.get(it.rid).push({ ordinal: Number(it.ordinal), oil: oilName.get(it.item) })
}

// canonical oil ordering (oils are order-independent in game → sort for stable lookups/diffs)
const canon = (oils) => [...oils].sort((a, b) => OIL_ORDER.indexOf(a) - OIL_ORDER.indexOf(b))

const table = new Map() // notable → [oil,oil,oil]
const problems = []
const unknownOils = new Set()
for (const r of recipes) {
  const notable = r.notable
  const raw = (oilsByRecipe.get(r.rid) ?? []).sort((a, b) => a.ordinal - b.ordinal).map((x) => x.oil)
  if (!notable) { problems.push(`recipe ${r.rid}: no notable name`); continue }
  if (raw.length !== 3) { problems.push(`${notable} (${r.rid}): ${raw.length} oils, expected 3`); continue }
  for (const o of raw) if (!OIL_ORDER.includes(o)) { unknownOils.add(String(o)); }
  if (raw.some((o) => !OIL_ORDER.includes(o))) { problems.push(`${notable} (${r.rid}): unknown oil in ${JSON.stringify(raw)}`); continue }
  const oils = canon(raw)
  const prev = table.get(notable)
  if (prev && JSON.stringify(prev) !== JSON.stringify(oils)) {
    problems.push(`DUPLICATE notable "${notable}" with different oils: ${JSON.stringify(prev)} vs ${JSON.stringify(oils)}`)
    continue
  }
  table.set(notable, oils)
}

// ── verification asserts (fail loud before writing) ──────────────────────────────
const fail = (m) => { console.error(`✗ ASSERT FAILED: ${m}`); process.exitCode = 1 }
const usesPrismatic = [...table.values()].filter((t) => t.includes('Prismatic')).length
const whispers = table.get('Whispers of Doom')
console.log(`\nfetched ${recipes.length} amulet recipes → ${table.size} notables (Prismatic-using: ${usesPrismatic})`)
if (unknownOils.size) fail(`unknown oils (not standard 13 + Prismatic): ${[...unknownOils].join(', ')}`)
if (problems.length) { console.error('problems:'); for (const p of problems.slice(0, 20)) console.error('  -', p) }
if (problems.filter((p) => /DUPLICATE|unknown oil|no notable/.test(p)).length) fail('hard data problems above')
if (JSON.stringify(whispers) !== JSON.stringify(['Golden', 'Golden', 'Golden'])) fail(`anchor: Whispers of Doom = ${JSON.stringify(whispers)} (expected 3× Golden)`)
else console.log('✓ anchor: Whispers of Doom → Golden + Golden + Golden')
if (table.size < 200 || table.size > 1000) fail(`count ${table.size} outside sane range [200,1000]`)
else console.log(`✓ count: ${table.size} amulet recipes (sane)`)
for (const [n, t] of table) if (t.length !== 3 || t.some((o) => !OIL_ORDER.includes(o))) fail(`bad recipe ${n}: ${JSON.stringify(t)}`)
console.log('✓ every recipe is exactly 3 valid oils')
// +30 generic-attribute anoints were removed in 3.25 — correctly absent, not errored.
const removedAttr = ['Strength', 'Dexterity', 'Intelligence'].filter((a) => table.has(a))
console.log(removedAttr.length ? `… note: generic attribute anoints present: ${removedAttr.join(', ')}` : '✓ generic +30 attribute anoints correctly absent (removed 3.25)')
if (process.exitCode === 1) { console.error('\nNOT writing — fix the data problems first.'); process.exit(1) }

// ── emit data/anointRecipes.ts (sorted by notable for stable diffs) ──────────────
const entries = [...table.entries()].sort((a, b) => a[0].localeCompare(b[0]))
const recipeLines = entries.map(([n, oils]) => `  ${JSON.stringify(n)}: [${oils.map((o) => `'${o}'`).join(', ')}],`).join('\n')
const today = new Date().toISOString().slice(0, 10)
const ts = `/**
 * data — Blight oils + amulet anoint recipes (notable → fixed 3-oil combination).
 *
 * GENERATED by scripts/gen-anoints.mjs — DO NOT EDIT BY HAND. Regenerate per league:
 *   npm run gen:anoints
 *
 * Source     : poewiki Cargo \`blight_crafting_recipes\` (type UniqueOrAmulet), joined to
 *              \`passive_skills\` (notable name) + \`blight_crafting_recipes_items\`/\`items\` (oils).
 *              ${SOURCE}
 * Retrieved  : ${today}
 * Diagnosis  : the recipes are NOT in any game export (docs/reports/anoint-producer.md, anoint-gen.md);
 *              this Cargo table is the authoritative current source. Oils are resolved from the data,
 *              never assumed from tier order (e.g. Indigo = Mushrune6b, not Mushrune7).
 *
 * Amulet anoints only. Ring + blight-map recipes are separate Cargo sets (type Ring / InfectedMap) —
 * not included. Oils are order-independent in game; stored canonically (sorted by tier) for stable
 * lookups. Prismatic is an anoint-only exclusive oil (kept out of OIL_TIERS so that stays the 13).
 */

/** The 13 standard Blight oils, cheapest → priciest (3 of a tier vendor up to 1 of the next). */
export const OIL_TIERS = [
  'Clear', 'Sepia', 'Amber', 'Verdant', 'Teal', 'Azure', 'Indigo',
  'Violet', 'Crimson', 'Black', 'Opalescent', 'Silver', 'Golden',
] as const
/** Anoint-only exclusive oils that also appear as recipe components (not in OIL_TIERS). */
export const ANOINT_ONLY_OILS = ['Prismatic'] as const
export type Oil = (typeof OIL_TIERS)[number] | (typeof ANOINT_ONLY_OILS)[number]

/** Amulet anoint recipes — notable → its fixed 3 oils (canonical order). ${entries.length} entries. */
export const ANOINT_RECIPES: Record<string, [Oil, Oil, Oil]> = {
${recipeLines}
}

/** Is a notable in the amulet anoint table? */
export const isAnointableNotable = (notable: string): boolean => notable in ANOINT_RECIPES
`
writeFileSync(OUT, ts)
console.log(`\n✓ wrote ${OUT} (${entries.length} recipes)`)
