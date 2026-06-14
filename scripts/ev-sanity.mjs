/**
 * Phase 1 — EV sanity harness (LIVE).
 *
 * First-pass cross-check that the RePoE weight data + the live economy services
 * together produce believable craft expected-attempts/cost, BEFORE the full
 * calc_craft_cost port. Run with tsx so it composes the TS data + service layers:
 *
 *   npx tsx scripts/ev-sanity.mjs
 *
 * Prices come from the existing economy services (poe.watch + poe.ninja). Exits
 * non-zero on any failed assertion. This is a sanity gate, not the full EV model.
 */
import { getEssences, getMods, getBaseItems } from '../src/data/repoe.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'

let failures = 0
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}

/** Minimal spawn-weight slice (same approach as validate-repoe; full model is Track A). */
function prefixPool(mods, tags, ilvl) {
  const out = []
  for (const [id, m] of Object.entries(mods)) {
    if (m.domain !== 'item' || m.generation_type !== 'prefix' || m.is_essence_only) continue
    if (m.required_level > ilvl) continue
    let w = 0
    for (const sw of m.spawn_weights) { if (tags.has(sw.tag) || sw.tag === 'default') { w = sw.weight; break } }
    if (w <= 0) continue
    out.push({ id, group: m.groups?.[0] ?? id, w })
  }
  return out
}

console.log('=== EV sanity harness (Phase 1, live) ===\n')

const league = await resolveCurrentLeague()
const provider = getEconomyProvider()
const snapshot = await provider.getEconomySnapshot(league)
console.log(`league: ${league}\n`)

const priceOf = (name, category) => {
  const m = searchEconomy(snapshot, name, category)
  return m.length ? m[0].chaosValue : null
}

const [mods, bases, essences] = await Promise.all([getMods(), getBaseItems(), getEssences()])

// ── Live-price leg: the economy data the cost model depends on must be live ───
console.log('--- Live price leg (orbs + a finished item must price) ---')
const divine = priceOf('Divine Orb', 'currency')
const alt = priceOf('Orb of Alteration', 'currency')
const regal = priceOf('Regal Orb', 'currency')
const hh = priceOf('Headhunter', 'unique')
ok('Divine Orb prices live', !!divine && divine > 0, divine ? `${divine.toFixed(0)}c` : 'missing')
ok('Orb of Alteration prices live', !!alt && alt > 0, alt ? `${alt.toFixed(2)}c` : 'missing')
ok('Regal Orb prices live', !!regal && regal > 0, regal ? `${regal.toFixed(2)}c` : 'missing')
ok('finished item (Headhunter) prices live', !!hh && hh > 0, hh ? `${hh.toFixed(0)}c (${(hh / (divine || 1)).toFixed(1)} div)` : 'missing')

// ── Case 1 — essence slam (deterministic; CoE oracle = forced mod is 100%) ────
console.log('\n--- Case 1: essence slam (deterministic) ---')
const greed = Object.values(essences).find(e => /deafening/i.test(e.name) && /greed/i.test(e.name))
const forced = greed?.mods?.['Body Armour']
ok('Deafening Essence of Greed forces a Body Armour mod', !!forced && !!mods[forced], `forced=${forced}`)
const essPrice = priceOf('Deafening Essence of Greed', 'essence') ?? priceOf('Deafening Essence of Greed')
const essAttempts = 1 // forced mod ⇒ guaranteed in one slam (CoE: 100%)
ok('essence prices live', !!essPrice && essPrice > 0, essPrice ? `${essPrice.toFixed(1)}c` : 'missing')
if (essPrice) {
  const cost = essAttempts * essPrice
  console.log(`      EV(forced life mod) = ${essAttempts} slam × ${essPrice.toFixed(1)}c = ${cost.toFixed(1)}c (${(cost / (divine || 1)).toFixed(3)} div)`)
  ok('essence-slam EV is finite & positive', Number.isFinite(cost) && cost > 0)
}

// ── Case 2 — alt→regal odds for a common prefix (weight → expected attempts) ──
console.log('\n--- Case 2: alt→regal for Increased Life prefix (Vaal Regalia, ilvl 84) ---')
const vr = Object.values(bases).find(b => b.name === 'Vaal Regalia' && b.release_state === 'released')
const tags = new Set(vr.tags)
const pool = prefixPool(mods, tags, 84)
const total = pool.reduce((s, e) => s + e.w, 0)
const lifeW = pool.filter(e => e.group === 'IncreasedLife').reduce((s, e) => s + e.w, 0)
const share = lifeW / total                 // P(life | a prefix is rolled)
const expAlts = share > 0 ? 1 / share : Infinity   // first-pass upper bound (ignores magic mod-count weighting)
ok('life prefix share computed', share > 0 && share < 1, `${(share * 100).toFixed(1)}%`)
ok('expected alts is sane (< 50 for a common mod)', expAlts > 1 && expAlts < 50, `~${expAlts.toFixed(1)} alts`)
if (alt && regal && expAlts < 50) {
  const cost = expAlts * alt + regal
  console.log(`      EV(alt→regal, life prefix) ≈ ${expAlts.toFixed(1)}×${alt.toFixed(2)}c + ${regal.toFixed(1)}c = ${cost.toFixed(1)}c  [first-pass: ignores magic 1-vs-2-mod weighting]`)
  ok('alt→regal EV is finite & positive', Number.isFinite(cost) && cost > 0)
}

console.log(`\n=== ${failures === 0 ? 'ALL EV SANITY CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`)
process.exit(failures === 0 ? 0 : 1)
