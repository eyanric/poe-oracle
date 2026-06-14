/**
 * Phase 0 — RePoE data-source validation harness.
 *
 * Confirms the crafting-EV data source is (1) LIVE, (2) CURRENT-PATCH, and
 * (3) numerically sound BEFORE any of it is ported into the data layer. Bad spawn-weight
 * data produces confidently-wrong EV — worse than no tool — so this gate runs first.
 *
 *   node packages/poe-mcp/scripts/validate-repoe.mjs
 *
 * Exits non-zero if any assertion fails. Data source: repoe-fork.github.io (the
 * MAINTAINED fork, hosted JSON exports — NOT legacy brather1ng/RePoE, which needs a
 * custom PyPoE fork to regenerate). We consume DATA, not GPL code.
 */
const HOST = 'https://repoe-fork.github.io'
const LEAGUE_START = Date.parse('2026-03-06T00:00:00Z') // Mirage (3.28) launch — freshness floor

let failures = 0
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}
const approx = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol

async function getJson(file) {
  const r = await fetch(`${HOST}/${file}`)
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
  return { lastMod: r.headers.get('last-modified'), body: await r.json() }
}

/** Minimal, self-contained spawn-weight slice (the Phase 1 port hardens this). */
function modPool(mods, tags, ilvl) {
  const prefixes = [], suffixes = []
  for (const [id, m] of Object.entries(mods)) {
    if (m.domain !== 'item') continue
    if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue
    if (m.is_essence_only) continue
    if (m.required_level > ilvl) continue
    let w = 0
    for (const sw of m.spawn_weights) {
      if (tags.has(sw.tag) || sw.tag === 'default') { w = sw.weight; break }
    }
    if (w <= 0) continue
    for (const gw of m.generation_weights ?? []) {
      if (tags.has(gw.tag) || gw.tag === 'default') { w = Math.round((w * gw.weight) / 100); break }
    }
    if (w <= 0) continue
    ;(m.generation_type === 'prefix' ? prefixes : suffixes).push({ id, group: m.groups?.[0] ?? id, w })
  }
  return { prefixes, suffixes }
}

console.log('=== RePoE data-source validation (Phase 0) ===\n')

// ── 1. FRESHNESS ─────────────────────────────────────────────────────────────
console.log('--- Freshness (live + current patch 3.28 Mirage) ---')
const files = {}
for (const f of ['mods.min.json', 'base_items.min.json', 'essences.min.json', 'fossils.min.json']) {
  const { lastMod, body } = await getJson(f)
  files[f] = body
  const t = Date.parse(lastMod)
  ok(`${f} live & fresh`, Number.isFinite(t) && t >= LEAGUE_START, `Last-Modified ${lastMod}`)
}
const mods = files['mods.min.json']
const bases = files['base_items.min.json']
const essences = files['essences.min.json']
const fossils = files['fossils.min.json']

// ── 2. STRUCTURE ─────────────────────────────────────────────────────────────
console.log('\n--- Structural completeness (fields the weight model needs) ---')
ok('mods is a non-empty record', Object.keys(mods).length > 1000, `${Object.keys(mods).length} mods`)
const sampleMod = mods['IncreasedLife11']
ok('mod has weight-model fields', !!sampleMod &&
  ['domain', 'generation_type', 'required_level', 'groups', 'spawn_weights'].every(k => k in sampleMod))
const vr = Object.values(bases).find(b => b.name === 'Vaal Regalia' && b.release_state === 'released')
ok('base_items carry tags + item_class', !!vr && Array.isArray(vr.tags) && !!vr.item_class, vr && `Vaal Regalia [${vr.tags.join(', ')}]`)
ok('essences map item_class → mod_id', Object.values(essences).every(e => e.mods && typeof e.mods === 'object'), `${Object.keys(essences).length} essences`)
ok('fossils carry weight arrays', Object.values(fossils).every(f => Array.isArray(f.positive_mod_weights) && Array.isArray(f.negative_mod_weights)), `${Object.keys(fossils).length} fossils`)

const tags = new Set(vr.tags)

// ── 3. CASE A — pool sanity + weight normalization (Vaal Regalia @ ilvl 84) ───
console.log('\n--- Case A: mod-pool sanity & weight normalization (Vaal Regalia, ilvl 84) ---')
const pool = modPool(mods, tags, 84)
const totalPre = pool.prefixes.reduce((s, e) => s + e.w, 0)
const totalSuf = pool.suffixes.reduce((s, e) => s + e.w, 0)
ok('prefix & suffix pools non-empty', pool.prefixes.length > 5 && pool.suffixes.length > 5,
  `${pool.prefixes.length} prefixes / ${pool.suffixes.length} suffixes`)
// per-mod probabilities within a slot must sum to 1 (no double-count / NaN)
const preProbSum = pool.prefixes.reduce((s, e) => s + e.w / totalPre, 0)
const sufProbSum = pool.suffixes.reduce((s, e) => s + e.w / totalSuf, 0)
ok('prefix slot probabilities sum to 1', approx(preProbSum, 1, 1e-9), `Σ=${preProbSum.toFixed(12)}`)
ok('suffix slot probabilities sum to 1', approx(sufProbSum, 1, 1e-9), `Σ=${sufProbSum.toFixed(12)}`)
// life present & high-weight; report its share of the prefix slot
const lifeGroupWeight = pool.prefixes.filter(e => e.group === 'IncreasedLife').reduce((s, e) => s + e.w, 0)
const lifeShare = lifeGroupWeight / totalPre
ok('Increased Life prefix present', lifeGroupWeight > 0)
ok('life prefix share in a believable band (2%–25%)', lifeShare > 0.02 && lifeShare < 0.25,
  `${(lifeShare * 100).toFixed(2)}% of prefix slot weight`)
const top = [...pool.prefixes].sort((a, b) => b.w - a.w).slice(0, 5).map(e => `${e.group}:${e.w}`)
console.log('      top prefixes:', top.join('  '))

// ── 4. CASE B — ilvl gating + equal-weight tier conditional (Increased Life) ──
console.log('\n--- Case B: ilvl gating + equal-weight tiers (alt-spam tier odds) ---')
const lifeTiers = (ilvl) => Object.entries(mods)
  .filter(([, m]) => m.generation_type === 'prefix' && m.groups?.includes('IncreasedLife') &&
    m.domain === 'item' && !m.is_essence_only && m.required_level <= ilvl &&
    (m.spawn_weights.find(s => tags.has(s.tag) || s.tag === 'default')?.weight ?? 0) > 0)
  .map(([id, m]) => ({ id, w: m.spawn_weights.find(s => tags.has(s.tag) || s.tag === 'default').weight, req: m.required_level }))
const t84 = lifeTiers(84), t100 = lifeTiers(100)
ok('ilvl gating changes the pool (84→12, 100→13 life tiers)', t84.length === 12 && t100.length === 13,
  `@84=${t84.length}, @100=${t100.length}`)
ok('all available life tiers share weight 1000', t84.every(t => t.w === 1000))
// equal weights ⇒ P(specific tier | life rolled) = 1/N, exactly (matches Craft-of-Exile equal-tier odds)
const pTier84 = 1 / t84.length
ok('P(specific life tier | life) == 1/12 @ ilvl84', approx(pTier84, 1 / 12), `${(pTier84 * 100).toFixed(2)}%`)
// essence-only tiers must be excluded from the normal pool
const essenceTiersInPool = pool.prefixes.filter(e => /Essence/.test(e.id)).length
ok('essence-only life tiers excluded from normal pool', essenceTiersInPool === 0)

// ── 5. CASE C — essence-slam determinism (Deafening Essence of Greed) ─────────
console.log('\n--- Case C: essence-slam determinism (forced mod resolves & is real) ---')
const greed = Object.values(essences).find(e => /deafening/i.test(e.name) && /greed/i.test(e.name))
ok('Deafening Essence of Greed exists', !!greed, greed?.name)
const forcedId = greed?.mods?.['Body Armour']
ok('essence → Body Armour forces IncreasedLife11', forcedId === 'IncreasedLife11', `forced=${forcedId}`)
const forced = forcedId && mods[forcedId]
ok('forced mod resolves to a real prefix in group IncreasedLife', !!forced &&
  forced.generation_type === 'prefix' && forced.groups?.includes('IncreasedLife'),
  forced && `req ${forced.required_level}`)
const forcedWeightOnVR = forced ? (forced.spawn_weights.find(s => tags.has(s.tag) || s.tag === 'default')?.weight ?? 0) : 0
ok('forced mod is spawnable on the base (weight > 0) ⇒ P=1 by mechanic', forcedWeightOnVR > 0, `weight ${forcedWeightOnVR}`)

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`)
process.exit(failures === 0 ? 0 : 1)
