/**
 * Bench + meta-crafting validation (LIVE) — npm run validate:bench
 *
 * Drives calc_craft_cost's new bench/multimod/slam methods against the real RePoE
 * crafting-bench export + live prices. Leads with the COST-SOURCE finding: the
 * export's bench/meta costs read as pre-3.28 (multimod 2 Divine, bench in alt/chaos),
 * NOT the 3.28 "standardized ~4 Exalted" rework — so costs are low-confidence.
 */
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { getBenchOptions, getMods } from '../src/data/repoe.js'
import { normalizeBench } from '../src/services/benchCrafting.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

let failures = 0
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) failures++ }
const div = (r, c) => (c == null ? '—' : `${c.toFixed(0)}c${r.divineChaos ? ` (${(c / r.divineChaos).toFixed(2)} div)` : ''}`)

const league = await resolveCurrentLeague()
console.log(`=== bench + meta-crafting validation — ${league} ===\n`)

// ── Cost-source finding ──────────────────────────────────────────────────────
const [opts, mods] = await Promise.all([getBenchOptions(), getMods()])
const bench = normalizeBench(opts, mods)
console.log('--- data source: RePoE crafting_bench_options ---')
console.log(`  bench crafts: ${bench.crafts.filter(c => !c.meta).length} · meta-mods: ${Object.keys(bench.meta).length}`)
const mm = bench.meta.multimod
console.log(`  multimod cost (export): ${mm?.costAmount} × ${mm?.costName}  ⚠ pre-3.28 (3.28 notes say bench ~4 Exalted)`)
ok('multimod present, costed in Divine (pre-3.28 reading)', mm?.costName === 'Divine Orb' && mm?.costAmount === 2, `${mm?.costAmount} Divine`)
ok('protective + cannot-roll meta-mods present', !!bench.meta.lockPrefixes && !!bench.meta.lockSuffixes && !!bench.meta.noAttack && !!bench.meta.noCaster)

// ── 1. Pure bench craft → deterministic ──────────────────────────────────────
console.log('\n--- 1: pure bench craft (Body Armour: +Life) ---')
const c1 = await estimateCraftCostLive({ baseName: 'Vaal Regalia', ilvl: 84, desired: [], method: { kind: 'bench', benchMods: ['maximum Life'] } }, league)
ok('supported + deterministic + zero brick', c1.supported && c1.risk?.category === 'deterministic' && c1.risk?.bricks.length === 0,
  `det=${c1.risk?.determinism.score}, cost ${div(c1, c1.totalChaos)}`)

// ── 2. Multimod craft vs the known ~2-divine figure ──────────────────────────
console.log('\n--- 2: multimod (Life + Fire Res + Cold Res) ---')
const c2 = await estimateCraftCostLive({ baseName: 'Vaal Regalia', ilvl: 84, desired: [], method: { kind: 'multimod', benchMods: ['maximum Life', 'Fire Resistance', 'Cold Resistance'] } }, league)
ok('supported + deterministic', c2.supported && c2.risk?.category === 'deterministic', `cost ${div(c2, c2.totalChaos)}`)
ok('total ≥ the multimod meta (~2 div) + bench mods', c2.totalChaos != null && c2.divineChaos != null && c2.totalChaos >= 2 * c2.divineChaos,
  `${div(c2, c2.totalChaos)} vs multimod alone ~${div(c2, 2 * (c2.divineChaos ?? 0))}`)

// ── 3. THE CRUX: same exalt slam, unprotected vs protected ───────────────────
console.log('\n--- 3: exalt slam — unprotected vs protected (base value 1000c) ---')
const target = [{ slot: 'prefix', group: 'IncreasedLife', label: 'Increased Life' }]
const unp = await estimateCraftCostLive({ baseName: 'Vaal Regalia', ilvl: 84, desired: target, method: { kind: 'slam', baseValueChaos: 1000 } }, league)
const pro = await estimateCraftCostLive({ baseName: 'Vaal Regalia', ilvl: 84, desired: target, method: { kind: 'slam', protect: 'suffixes', baseValueChaos: 1000 } }, league)
console.log(`  unprotected: category ${unp.risk?.category}, VaR ${div(unp, unp.risk?.bricks[0]?.valueAtRisk)}, det ${unp.risk?.determinism.score}, p90 ${div(unp, unp.risk?.distribution.p90)}`)
console.log(`  protected:   category ${pro.risk?.category}, bricks ${pro.risk?.bricks.length}, det ${pro.risk?.determinism.score}, p90 ${div(pro, pro.risk?.distribution.p90)}`)
ok('unprotected slam = high-brick with value-at-risk', unp.risk?.category === 'high-brick' && (unp.risk?.bricks[0]?.valueAtRisk ?? 0) >= 1000)
ok('protected slam flips OUT of high-brick (no brick, VaR gone)', pro.risk?.category !== 'high-brick' && pro.risk?.bricks.length === 0)
ok('protection raises determinism', (pro.risk?.determinism.score ?? 0) > (unp.risk?.determinism.score ?? 1))

console.log(`\n=== ${failures === 0 ? 'ALL BENCH/META CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`)
console.log('NOTE: bench/meta COST AMOUNTS are low-confidence (RePoE export reads pre-3.28). Structure is reliable.')
process.exit(failures === 0 ? 0 : 1)
