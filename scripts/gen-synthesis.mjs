/**
 * gen-synthesis — regenerate data/synthesisImplicits.ts from the poewiki Cargo data. Run with tsx.
 *
 *   npm run gen:synthesis            # fetch fresh (browser UA + polite delay), emit the .ts
 *   npm run gen:synthesis -- --cache # reuse the local raw-pull cache (scripts/.cache, gitignored)
 *
 * The synthesised-item implicit pool is NOT in repoe-fork with usable data: the `synthesis_*`
 * generation types there are MAP/Memory mods, and the real `SynthesisImplicit*` gear mods carry
 * EMPTY spawn_weights. The poewiki `synthesis_mods` Cargo table is the authoritative per-item-class
 * pool (item_class_ids → mod_ids). DIAGNOSIS (docs/reports/synthesis-pool.md): synthesis implicits
 * have NO spawn weights anywhere (verified: repoe-fork spawn_weights=[]; poewiki mod_spawn_weights has
 * no rows for them, while a normal explicit has tag/weight rows). So the reroll is honestly UNIFORM
 * over the real per-class pool — this sources the real pool SIZE per item class (replacing the prior
 * caller-supplied guess); it does NOT invent weights.
 *
 * Per-league refresh: re-run after a patch, commit the regenerated .ts.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'data', 'synthesisImplicits.ts')
const CACHE_DIR = join(HERE, '.cache')
const USE_CACHE = process.argv.includes('--cache')
const SOURCE = 'https://www.poewiki.net/wiki/Synthesis (Cargo: synthesis_mods)'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const EXPORT = 'https://www.poewiki.net/index.php?title=Special:CargoExport'
const DELAY_MS = 400
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
        'If this is a 403/429, STOP and report: the browser-UA path failed. Do not fabricate the pool.')
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

const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])

console.log(`=== gen-synthesis (${USE_CACHE ? 'cache' : 'live fetch, browser UA'}) ===`)

// synthesis_mods: per-item-class gear synthesis implicits (item_class_ids → mod_ids, one row per stat)
const rows = await cargo('synthesis_mods',
  'tables=synthesis_mods&fields=' + encodeURIComponent('item_class_ids,mod_ids,stat_text'))

// group by item class → distinct mod-id-combos (reroll OPTIONS) + distinct individual mod ids (membership)
const byClass = new Map() // class → { combos:Set<string>, mods:Set<string> }
for (const r of rows) {
  const classes = asArray(r['item class ids'])
  const modIds = asArray(r['mod ids']).filter(Boolean)
  if (!modIds.length) continue
  const combo = [...modIds].sort().join('+')
  for (const c of classes) {
    if (!c) continue
    if (!byClass.has(c)) byClass.set(c, { combos: new Set(), mods: new Set() })
    const e = byClass.get(c)
    e.combos.add(combo)
    for (const m of modIds) e.mods.add(m)
  }
}

const pool = {} // class → { options, mods[] }
for (const [c, e] of byClass) pool[c] = { options: e.combos.size, mods: [...e.mods].sort() }

// ── verification asserts ─────────────────────────────────────────────────────────
const fail = (m) => { console.error(`✗ ASSERT FAILED: ${m}`); process.exitCode = 1 }
const classes = Object.keys(pool)
console.log(`\nfetched ${rows.length} synthesis_mods rows → ${classes.length} item classes`)
if (classes.length < 15 || classes.length > 40) fail(`item-class count ${classes.length} outside sane [15,40]`)
else console.log(`✓ ${classes.length} item classes (sane)`)
const amulet = pool['Amulet']
if (!amulet || amulet.options < 100) fail(`Amulet pool missing/too small: ${JSON.stringify(amulet && amulet.options)}`)
else console.log(`✓ Amulet pool: ${amulet.options} options, ${amulet.mods.length} distinct implicit mods`)
const ring = pool['Ring']
const knownLife = ring && ring.mods.some((m) => /Life/.test(m))
if (!knownLife) fail('expected a Life-related synthesis implicit on Ring')
else console.log('✓ known implicit present (a Life synthesis implicit on Ring)')
let totalMods = 0
for (const c of classes) {
  const p = pool[c]
  if (p.options < 1) fail(`${c}: 0 options`)
  if (!p.mods.every((m) => /^Synthesis/.test(m))) fail(`${c}: a non-Synthesis mod id leaked in`)
  totalMods += p.mods.length
}
console.log(`✓ every class has options ≥ 1; all mod ids are Synthesis* (${totalMods} class-mod entries)`)
if (process.exitCode === 1) { console.error('\nNOT writing — fix the data problems first.'); process.exit(1) }

// ── emit data/synthesisImplicits.ts (classes sorted; one line per class for stable diffs) ──
const today = new Date().toISOString().slice(0, 10)
const lines = classes.sort().map((c) => {
  const p = pool[c]
  return `  ${JSON.stringify(c)}: { options: ${p.options}, mods: [${p.mods.map((m) => JSON.stringify(m)).join(', ')}] },`
}).join('\n')
const ts = `/**
 * data — synthesised-item IMPLICIT pool, per item class (for the Vivid Vulture reroll + producer).
 *
 * GENERATED by scripts/gen-synthesis.mjs — DO NOT EDIT BY HAND. Regenerate per league:
 *   npm run gen:synthesis
 *
 * Source     : poewiki Cargo \`synthesis_mods\` (item_class_ids → mod_ids). ${SOURCE}
 * Retrieved  : ${today}
 * Diagnosis  : synthesis implicits have NO spawn weights (verified — repoe-fork spawn_weights=[];
 *              poewiki mod_spawn_weights has no rows for SynthesisImplicit*). They are not weight-rolled,
 *              so the reroll is honestly UNIFORM over the real per-class pool; this sources the real pool
 *              SIZE per item class (no weights invented). See docs/reports/synthesis-pool.md.
 *
 * \`options\` = number of distinct synthesis-implicit OUTCOMES for the class (the reroll pool size ⇒
 * P(specific) = 1/options, uniform). \`mods\` = the distinct SynthesisImplicit* mod ids available on the
 * class (membership: is a desired implicit obtainable here). Gear classes only.
 */

export interface SynthesisClassPool {
  /** Distinct synthesis-implicit outcomes on this class — the reroll pool size (P = 1/options). */
  options: number
  /** Distinct SynthesisImplicit* mod ids available on this class (membership test). */
  mods: string[]
}

export const SYNTHESIS_POOL: Record<string, SynthesisClassPool> = {
${lines}
}

/** Reroll pool size for an item class (undefined if the class has no synthesis implicits). */
export const synthesisPoolSize = (itemClass: string): number | undefined => SYNTHESIS_POOL[itemClass]?.options

/** Is \`modId\` a synthesis implicit obtainable on \`itemClass\`? */
export const isSynthesisImplicit = (itemClass: string, modId: string): boolean =>
  SYNTHESIS_POOL[itemClass]?.mods.includes(modId) ?? false
`
writeFileSync(OUT, ts)
console.log(`\n✓ wrote ${OUT} (${classes.length} classes)`)
