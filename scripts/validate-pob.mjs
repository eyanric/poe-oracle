/**
 * parse_pob real-export validation — corpus fetcher + stat ground-truth cross-check. Run with tsx.
 *
 *   npm run validate:pob -- <pobb.in-id> [<id> …]   # fetch each pobb.in build → fixture, then validate
 *   npm run validate:pob                             # validate every committed fixture (no fetch)
 *
 * THE CRUX: a PoB export embeds PoB's OWN computed stats (`<PlayerStat stat value/>`). This independently
 * regex-extracts every PlayerStat from the decoded XML and asserts our parser surfaces each one with the
 * same value — i.e. our extracted Life/ES/DPS/resist == the number PoB itself shows. Plus completeness
 * (items/mods/tree/skills). Real exports carry shapes fixtures never modelled; this is the regression net.
 *
 * Fetches pobb.in/<id>/raw with a browser UA + polite delay; caches raw pulls. Read-only; analysis-only.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodePobCode, parsePob } from '../src/services/pobParser.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX_DIR = join(HERE, '..', 'test', 'fixtures')
const REAL_DIR = join(FIX_DIR, 'real')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPobbIn(id) {
  const dest = join(REAL_DIR, `${id}.txt`)
  if (existsSync(dest)) { console.log(`  (cached) ${id}`); return readFileSync(dest, 'utf8') }
  const res = await fetch(`https://pobb.in/${id}/raw`, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`pobb.in/${id}/raw → HTTP ${res.status} (browser UA used). If blocked, supply the raw code instead.`)
  const code = (await res.text()).trim()
  mkdirSync(REAL_DIR, { recursive: true })
  writeFileSync(dest, code)
  console.log(`  fetched ${id} → ${dest}`)
  await sleep(500)
  return code
}

/** Ground-truth cross-check: every PlayerStat in the decoded XML must be surfaced by the parser, equal. */
export function statCrossCheck(code) {
  const xml = decodePobCode(code)
  const raw = {}
  for (const m of xml.matchAll(/<PlayerStat\s+stat="([^"]+)"\s+value="([^"]*)"\s*\/?>/g)) {
    const v = Number(m[2])
    if (Number.isFinite(v)) raw[m[1]] = v
  }
  const parsed = parsePob(xml)
  const mismatches = []
  for (const [k, v] of Object.entries(raw)) {
    const got = parsed.stats[k]
    if (got === undefined) mismatches.push({ stat: k, raw: v, got: 'MISSING' })
    else if (Math.abs(got - v) > Math.max(1e-6, Math.abs(v) * 1e-9)) mismatches.push({ stat: k, raw: v, got })
  }
  return { parsed, rawCount: Object.keys(raw).length, raw, mismatches }
}

const KEY_STATS = ['Life', 'EnergyShield', 'Mana', 'Armour', 'Evasion', 'TotalDPS', 'CombinedDPS', 'FullDPS', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist']

function validate(name, code) {
  try {
    const { parsed, rawCount, raw, mismatches } = statCrossCheck(code)
    const dps = raw.FullDPS ?? raw.CombinedDPS ?? raw.TotalDPS
    const keys = KEY_STATS.filter((k) => raw[k] != null).map((k) => `${k}=${Math.round(raw[k])}`).slice(0, 6).join(' ')
    console.log(`\n■ ${name}`)
    console.log(`  identity : ${parsed.className}/${parsed.ascendancy || '—'} L${parsed.level} · main: ${parsed.mainSkill ?? '—'}`)
    console.log(`  stats    : ${rawCount} PlayerStats · ${keys}${dps ? ` · DPS=${Math.round(dps)}` : ''}`)
    console.log(`  X-check  : ${mismatches.length === 0 ? '✓ all PlayerStats surfaced equal to PoB' : `✗ ${mismatches.length} MISMATCH: ${JSON.stringify(mismatches.slice(0, 4))}`}`)
    console.log(`  complete : items=${parsed.items.length} (mods ${parsed.items.reduce((s, i) => s + i.mods.length, 0)}) · skillGroups=${parsed.skillGroups.length} · trees=${parsed.trees.map((t) => t.nodeCount).join('/')}`)
    return mismatches.length === 0
  } catch (e) {
    console.log(`\n■ ${name}\n  ✗ PARSE ERROR: ${e.message}`)
    return false
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────
const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'))
console.log('=== parse_pob real-export validation ===')
const corpus = []
for (const id of ids) { try { corpus.push([`pobb.in/${id}`, await fetchPobbIn(id)]) } catch (e) { console.log(`  ✗ ${id}: ${e.message}`) } }
// always include committed PoB fixtures (pob-*.txt in fixtures/, everything in fixtures/real/)
for (const dir of [FIX_DIR, REAL_DIR]) {
  if (!existsSync(dir)) continue
  const isPob = (f) => dir === REAL_DIR || /^pob[-.]/i.test(f)
  for (const f of readdirSync(dir)) if (f.endsWith('.txt') && isPob(f) && !ids.includes(f.replace('.txt', ''))) corpus.push([`fixtures/${dir === REAL_DIR ? 'real/' : ''}${f}`, readFileSync(join(dir, f), 'utf8')])
}
let pass = 0
for (const [name, code] of corpus) if (validate(name, code)) pass++
console.log(`\n=== ${pass}/${corpus.length} builds: all PlayerStats surfaced == PoB's own values ===`)
const realCount = existsSync(REAL_DIR) ? readdirSync(REAL_DIR).filter((f) => f.endsWith('.txt')).length : 0
if (realCount < 6) console.log(`⚠ corpus has ${realCount} REAL exports — need ~6–8 diverse current-league builds (supply pobb.in ids or raw codes).`)
