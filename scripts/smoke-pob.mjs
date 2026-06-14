/**
 * Smoke / validation — parse_pob + passive tree + build-cost integration (LIVE tree).
 *
 *   npx tsx scripts/smoke-pob.mjs
 *
 * Parses the two real-format export fixtures, then validates the LIVE GGG tree path
 * (node lookup + distance + allocated-node classification on real data) and the
 * Phase 3 build-cost-from-PoB integration. Decode/link-resolver are unit-tested.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePobCode } from '../src/services/pobParser.js'
import { loadPassiveTree, lookupNode, distance, pathBetween, classifyAllocated } from '../src/services/passiveTree.js'
import { estimateBuildCostFromPobLive } from '../src/services/buildCost.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

const fx = n => readFileSync(fileURLToPath(new URL(`../test/fixtures/pob-${n}.txt`, import.meta.url)), 'utf8')

console.log('=== parse_pob + tree + build-cost smoke ===\n')

// 1) Parse both fixtures (offline) ------------------------------------------------
for (const n of ['leveling', 'endgame']) {
  const p = parsePobCode(fx(n))
  console.log(`[${n}] ${p.className}/${p.ascendancy || '-'} lvl ${p.level} · main ${p.mainSkill} · ${p.skillGroups.length} groups · ${p.items.length} items · ${p.trees[0].nodeCount} nodes`)
}

// 2) LIVE GGG passive tree --------------------------------------------------------
console.log('\n--- live passive tree (GGG export) ---')
const tree = await loadPassiveTree()
console.log(`loaded ${tree.nodes.size} nodes (tree ${tree.version})`)
const ci = lookupNode(tree, 'Chaos Inoculation')
console.log(`lookup "Chaos Inoculation" → id ${ci?.id} (${ci?.type}): "${ci?.stats[0]?.split('\n')[0]}"`)
const point = lookupNode(tree, 'Point Blank')
if (ci && point) {
  console.log(`distance Chaos Inoculation → Point Blank = ${distance(tree, ci.id, point.id)} points`)
  const path = pathBetween(tree, ci.id, point.id)
  console.log(`path length ${path?.length} nodes`)
}
// classify a real allocated set: CI + a couple of its neighbours
if (ci) {
  const sample = [ci.id, ...ci.adj.slice(0, 4)]
  const cls = classifyAllocated(tree, sample)
  console.log(`classifyAllocated(${sample.join(',')}) → keystones [${cls.keystones.join(', ')}], notables [${cls.notables.join(', ')}], unresolved ${cls.unresolved}`)
}

// 3) Phase 3 — build cost straight from a parsed PoB (LIVE prices) ----------------
console.log('\n--- build cost from parsed PoB (live) ---')
const league = await resolveCurrentLeague()
const cost = await estimateBuildCostFromPobLive(fx('endgame'), league)
console.log(`league ${cost.league} · tier ${cost.tier} · total ${cost.totalChaos?.toFixed(0)}c (${cost.totalDivine?.toFixed(2)} div) · ${cost.unpricedSlots.length} unpriced`)
for (const p of cost.pieces) console.log(`  ${p.slot}: ${p.name} = ${p.chaos != null ? p.chaos.toFixed(0) + 'c' : 'unpriced (' + (p.note ?? '') + ')'}`)

console.log('\nNOTE: fixtures are authored to PoB\'s exact export format (live 3rd-party fetch was blocked here); decode + link-resolver are unit-tested.')
