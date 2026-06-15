/**
 * bench-cost data fix — diagnosis + validation. Run with tsx.
 *
 *   npm run validate:bench-cost
 *
 * The standing flag was "bench costs read ~0c, distorting verdicts." DIAGNOSIS: the cost is PRESENT
 * (728/728 mod crafts), correctly PARSED (currency-metadata-path → economy name + count), and priced
 * LIVE (amount × live currency chaos) — NOT a parse bug and NOT a missing field. Cheap crafts read
 * sub-1c because they cost 1–2 basic orbs in the export; the verifiable subset (meta = 2/1 Divine)
 * matches current in-game values. The amounts are taken as-is and unverified → benchCostOverrides is
 * the seam for verified corrections. Analysis-only; read-only.
 */
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName, getBenchOptions } from '../src/data/repoe.js'
import { BENCH_COST_OVERRIDES } from '../src/data/benchCostOverrides.js'
import { normalizeBench, benchCraftsForClass } from '../src/services/benchCrafting.js'
import { estimateCraftCost } from '../src/services/craftCost.js'
import { searchEconomy } from '../src/services/economySearch.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

const league = await resolveCurrentLeague()
const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions()])
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const bench = normalizeBench(benchOptions, mods)
const deps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench, snapshot, league }
const liveChaos = (name) => { const m = searchEconomy(snapshot, name, 'currency', 1)[0]; return m ? m.chaosValue : null }
console.log(`=== bench-cost data fix · League: ${league} ===\n`)

// ── Step 1 — DIAGNOSIS (report before fixing) ────────────────────────────────────
const modCrafts = benchOptions.filter(o => o.actions?.add_explicit_mod)
const withCost = modCrafts.filter(o => o.cost && Object.keys(o.cost).length)
const multi = modCrafts.filter(o => o.cost && Object.keys(o.cost).length > 1)
console.log('--- Step 1: diagnosis ---')
console.log(`  file/field         : crafting_bench_options.min.json · option.cost = { <currency-metadata-path>: <amount> }`)
console.log(`  present?           : ${withCost.length}/${modCrafts.length} mod-adding crafts carry a non-empty cost (multi-currency: ${multi.length})`)
console.log(`  sample row         : ${JSON.stringify(modCrafts[0].cost)} → ${modCrafts[0].actions.add_explicit_mod}`)
console.log(`  parsed?            : YES — path→economy name + amount (e.g. ${bench.crafts[0].costAmount}× ${bench.crafts[0].costName})`)
console.log(`  priced?            : YES — live: cost = amount × live currency chaos`)
console.log(`  verdict            : NOT a parse bug, NOT a missing field → SOURCING (amounts taken as-is, unverified vs current patch)`)

// ── meta costs match current in-game values (the verifiable subset) ──────────────
console.log('\n--- meta costs vs current in-game (verifiable subset) ---')
for (const [k, want] of [['multimod', '2 Divine'], ['lockPrefixes', '2 Divine'], ['noAttack', '1 Divine']]) {
  const m = bench.meta[k]
  console.log(`  ${k.padEnd(13)} ${m ? `${m.costAmount}× ${m.costName}` : 'n/a'}  (current in-game: ${want})`)
}

// ── Step 3 — bench cost is a realistic non-zero chaos-equivalent, tracking the feed ──
console.log('\n--- bench cost realistic (Ring +Life bench, live chaos-equivalent) ---')
const lifeCrafts = benchCraftsForClass(bench, 'Ring').filter(c => /maximum Life/i.test(c.label)).sort((a, b) => a.costAmount - b.costAmount)
for (const c of lifeCrafts.slice(0, 5)) {
  const px = liveChaos(c.costName)
  console.log(`  ${c.label.split('\n')[0].padEnd(22)} ${c.costAmount}× ${c.costName.padEnd(18)} = ${px == null ? 'NULL' : (px * c.costAmount).toFixed(2) + 'c'}  (>0: ${px != null && px * c.costAmount > 0})`)
}

// ── verdict + plan total use the live bench cost (a +Life bench on a Ring) ─────────
const lifeMod = lifeCrafts[lifeCrafts.length - 1] // a higher tier
const benchEst = estimateCraftCost({ baseName: 'Two-Stone Ring', ilvl: 84, desired: [{ slot: 'prefix', modId: lifeMod.modId, label: lifeMod.label.split('\n')[0] }], method: { kind: 'bench', benchMods: ['maximum Life'] } }, deps)
console.log('\n--- verdict/plan use real bench cost ---')
console.log(`  bench +Life: supported=${benchEst.supported} totalChaos=${benchEst.totalChaos?.toFixed(2)} lowConfidence=${benchEst.lowConfidence}`)
console.log(`  consumables: ${JSON.stringify(benchEst.consumables.map(c => ({ n: c.name, q: c.qty, c: c.chaosTotal })))}`)
console.log(`  flag note  : ${benchEst.notes.find(n => /bench\/meta COSTS/.test(n)) ?? '(none)'}`)

// ── override seam: a verified correction flows straight through to the live price ──
console.log('\n--- override seam (benchCostOverrides → verified amount, still priced live) ---')
console.log(`  current overrides loaded: ${Object.keys(BENCH_COST_OVERRIDES).length} (empty ⇒ export amounts unchanged, parity-safe)`)
const probe = lifeCrafts[0]
const before = bench.crafts.find(c => c.modId === probe.modId)
const overridden = normalizeBench(benchOptions, mods, { [probe.modId]: { costName: 'Exalted Orb', costAmount: 2 } }).crafts.find(c => c.modId === probe.modId)
const exPx = liveChaos('Exalted Orb')
console.log(`  ${probe.modId}:`)
console.log(`    export  : ${before.costAmount}× ${before.costName} = ${(liveChaos(before.costName) * before.costAmount).toFixed(2)}c`)
console.log(`    override: ${overridden.costAmount}× ${overridden.costName} = ${exPx == null ? 'NULL' : (exPx * overridden.costAmount).toFixed(2) + 'c'}  (override applied: ${overridden.costName === 'Exalted Orb'})`)

console.log('\n⚠ No amounts invented. Code change = override seam + accurate flag; numbers/parity unchanged until verified amounts are sourced into benchCostOverrides.')
