/**
 * Recombinator validation (LIVE) — npm run validate:recombine
 *
 * Exercises the arity-2 combine end to end: P(target) + brick, ilvl/inheritance, the
 * exclusive-mod collision brick, recombinator-currency pricing, and league-gating.
 * Leads with: arity-2 routed through evaluateInputs; quantitative data is flagged.
 */
import { estimateRecombine, estimateRecombineLive } from '../src/services/craftCost.js'
import { getMods } from '../src/data/repoe.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

let failures = 0
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) failures++ }

const league = await resolveCurrentLeague()
console.log(`=== Recombinator validation — current league ${league} ===\n`)

const mods = await getMods()
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const recPrice = searchEconomy(snapshot, 'Jewellery Recombinator', undefined, 1)[0]
console.log('--- recombinator currency live price ---')
console.log(recPrice ? `  Jewellery Recombinator: ${recPrice.chaosValue}c (${recPrice.category})` : '  ⚠ Recombinator not in current snapshot (Settlers mechanic) — currency cost will be unpriced/flagged')

// Two input rings, A carries the desired prefix pair; value 10c + 5c each.
const itemA = { itemClass: 'Ring', ilvl: 84, valueChaos: 10,
  prefixes: [{ group: 'IncreasedLife', desired: true }, { group: 'FlatPhys', desired: true }], suffixes: [{ group: 'FireRes' }] }
const itemB = { itemClass: 'Ring', ilvl: 80, valueChaos: 5,
  prefixes: [{ group: 'SpellDamage' }], suffixes: [{ group: 'ColdRes' }] }
// deps: league 'Settlers' bypasses the availability gate so the math runs live-priced.
const deps = { mods, baseItems: {}, essences: {}, fossils: new Map(), snapshot, league: 'Settlers' }

console.log('\n--- concrete combine (want Life+FlatPhys prefixes) ---')
const r = estimateRecombine(itemA, itemB, deps)
console.log(`  output ilvl ${r.outputIlvl} (A84,B80) · pools ${r.prefixPool}p/${r.suffixPool}s · P(target) ${(r.pTarget * 100).toFixed(1)}% (pre ${(r.pPrefix * 100).toFixed(1)}% × suf ${(r.pSuffix * 100).toFixed(1)}%) · brick ${(r.brickProb * 100).toFixed(1)}%`)
console.log(`  expected attempts ${r.expectedAttempts.toFixed(1)} · cost ${r.totalChaos != null ? r.totalChaos.toFixed(0) + 'c' : 'unpriced'} · risk ${r.risk?.category ?? '—'}`)
ok('arity-2 combine supported + P(target) in (0,1)', r.supported && r.pTarget > 0 && r.pTarget < 1)
ok('output ilvl = min(max, floor(avg)+2) = 84', r.outputIlvl === 84)
ok('prefix pool = 3 (2 from A + 1 from B), independent of suffix pool 2', r.prefixPool === 3 && r.suffixPool === 2)
ok('input items folded into cost (2 consumed per attempt)', r.consumables.some(c => /input item/.test(c.name)))

console.log('\n--- exclusive-mod collision (guaranteed brick) ---')
const exA = { itemClass: 'Ring', ilvl: 84, valueChaos: 50, prefixes: [{ group: 'ExclOne', desired: true, exclusive: true }] }
const exB = { itemClass: 'Ring', ilvl: 84, valueChaos: 50, prefixes: [{ group: 'ExclTwo', desired: true, exclusive: true }] }
const ex = estimateRecombine(exA, exB, deps)
ok('two exclusive desired mods → unsupported/brick (≤1 survives)', !ex.supported && ex.exclusiveCollision, ex.reason)

console.log('\n--- league gating (current league) ---')
const gated = await estimateRecombineLive(itemA, itemB, league)
ok('recombine flagged league-specific / not active in current league (until availability confirmed)', !gated.supported && /league-specific/.test(gated.reason || ''), gated.reason)

console.log(`\n=== ${failures === 0 ? 'ALL RECOMBINE CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`)
console.log('NOTE: Stage-A count distribution + the exclusive-mod SET are low-confidence (not in the data export); Stage-B selection is exact.')
process.exit(failures === 0 ? 0 : 1)
