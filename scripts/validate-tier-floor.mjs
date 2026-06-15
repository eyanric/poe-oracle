/**
 * tier-floor target semantics — validation. Run with tsx.
 *
 *   npm run validate:tier-floor
 *
 * The goal test was exact-modId: "T1 Life" was satisfied ONLY by exact T1, so the solver costed
 * P(exact top tier) and overstated the price — hiding the cheap good-enough version. An opt-in
 * `minTier` floor widens a target to "this group at tier ≥ floor": the goal test, the roll
 * probability (Σ qualifying-tier weights / pool), the cost, and the buy-side all honor it. Default
 * stays exact (parity). Analysis-only; read-only.
 */
import { resolveTargets } from '../src/services/modProducer.js'
import { resolveBaseModIndex, modRollProbability } from '../src/services/modWeightIndex.js'
import { estimateCraftCost } from '../src/services/craftCost.js'
import { searchPlans } from '../src/services/solver.js'
import { newItemState } from '../src/services/itemState.js'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName, getBenchOptions } from '../src/data/repoe.js'
import { normalizeBench } from '../src/services/benchCrafting.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'

const league = await resolveCurrentLeague()
const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions()])
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const deps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league }
const ring = Object.values(baseItems).find(b => b.name === 'Two-Stone Ring' && b.release_state === 'released')
const ilvl = 84
console.log(`=== tier-floor target semantics · League: ${league} ===\n`)

// ── pick a real multi-tier prefix group on this base (the resolver surfaces the tiers) ──
const idx = resolveBaseModIndex(ring, mods, ilvl)
const byGroup = new Map()
for (const e of idx.prefixes) (byGroup.get(e.group) ?? byGroup.set(e.group, []).get(e.group)).push(e)
const lifeGroup = [...byGroup.values()].filter(es => es.length >= 3 && es.some(e => /life/i.test(e.text ?? '')))
  .sort((a, b) => b.length - a.length)[0] ?? [...byGroup.values()].sort((a, b) => b.length - a.length)[0]
const tiers = [...lifeGroup].sort((a, b) => a.tier - b.tier)
const group = tiers[0].group
const t1 = tiers.find(e => e.tier === 1)
const t2 = tiers.find(e => e.tier === 2)
const t3 = tiers.find(e => e.tier === 3)
console.log(`--- group "${group}" on ${ring.name} (ilvl ${ilvl}) — ${tiers.length} tiers ---`)
for (const e of tiers.slice(0, 5)) console.log(`  T${e.tier}  w=${String(e.weight).padStart(5)}  ${e.modId.padEnd(34)} ${(e.text ?? '').replace(/\n/g, ' / ').slice(0, 40)}`)

// ── floor probability: P(tier ≤ floor) = Σ qualifying weights / pool, between exact-T1 and whole-group ──
const pExactT1 = modRollProbability(idx, { affix: 'prefix', modId: t1.modId })
const pFloorT2 = modRollProbability(idx, { affix: 'prefix', group, minTier: 2 })
const pFloorT3 = modRollProbability(idx, { affix: 'prefix', group, minTier: 3 })
const pWhole = modRollProbability(idx, { affix: 'prefix', group })
console.log('\n--- floor probability (P = Σ qualifying-tier weights / pool) ---')
console.log(`  P(exact T1)      = ${pExactT1.toFixed(5)}`)
console.log(`  P(tier ≤ 2/floor)= ${pFloorT2.toFixed(5)}   (T1+T2)  ≥ exact-T1: ${pFloorT2 >= pExactT1}`)
console.log(`  P(tier ≤ 3/floor)= ${pFloorT3.toFixed(5)}`)
console.log(`  P(whole group)   = ${pWhole.toFixed(5)}   floor monotone & ≤ whole-group: ${pExactT1 <= pFloorT2 && pFloorT2 <= pFloorT3 && pFloorT3 <= pWhole + 1e-9}`)

// ── floor cost: a T2-floor craft is materially CHEAPER than the exact-top-tier craft ──
const cost = (d) => estimateCraftCost({ baseName: ring.name, ilvl, desired: [d], method: { kind: 'alt-regal' } }, deps)
const exactCost = cost({ slot: 'prefix', modId: t1.modId, label: `exact ${t1.modId}` })
const floorCost = cost({ slot: 'prefix', group, minTier: 2, label: `${group} ≥ T2` })
console.log('\n--- floor cost (alt-regal; floored ⇒ higher per-attempt P ⇒ fewer attempts ⇒ cheaper) ---')
console.log(`  exact T1 : perAttemptP=${exactCost.perAttemptProb.toFixed(5)}  totalChaos=${exactCost.totalChaos?.toFixed(1) ?? 'n/a'}`)
console.log(`  ≥ T2     : perAttemptP=${floorCost.perAttemptProb.toFixed(5)}  totalChaos=${floorCost.totalChaos?.toFixed(1) ?? 'n/a'}`)
console.log(`  floored P > exact P: ${floorCost.perAttemptProb > exactCost.perAttemptProb} · floored cheaper: ${(floorCost.totalChaos ?? Infinity) < (exactCost.totalChaos ?? Infinity)}`)

// ── tradeoff surfaced: same stat at exact-T1 vs ≥T2 returns two plans with the cost gap visible ──
const floorPlan = searchPlans({ base: ring.name, ilvl, desired: [{ slot: 'prefix', group, minTier: 2, label: `${group} ≥ T2` }] }, deps)
const exactPlan = searchPlans({ base: ring.name, ilvl, desired: [{ slot: 'prefix', modId: t1.modId, label: `exact ${t1.modId}` }] }, deps)
console.log('\n--- good-enough-vs-perfect tradeoff (two plans, cost gap visible) ---')
console.log(`  ≥ T2 plan : ${floorPlan.cheapestPlan?.moves.map(m => m.label).join(' → ')}  rankChaos=${floorPlan.cheapestPlan?.rankChaos?.toFixed(1)}`)
console.log(`  exact T1  : ${exactPlan.cheapestPlan?.moves.map(m => m.label).join(' → ')}  rankChaos=${exactPlan.cheapestPlan?.rankChaos?.toFixed(1)}`)
console.log(`  floored solves cheaper-or-equal: ${(floorPlan.cheapestPlan?.rankChaos ?? Infinity) <= (exactPlan.cheapestPlan?.rankChaos ?? Infinity)}`)

// ── floor goal test: present T2 satisfies ≥T2 (no work); present T3 does NOT (search must produce) ──
const mkRing = (over) => newItemState({ base: ring.name, itemClass: ring.item_class, ilvl, tags: [...ring.tags], rarity: 'rare', ...over })
const floored = { slot: 'prefix', group, minTier: 2, label: `${group} ≥ T2` }
const startT2 = searchPlans({ base: ring.name, ilvl, start: mkRing({ affixes: [{ slot: 'prefix', group, modId: t2.modId, tier: 2 }] }), desired: [floored] }, deps)
const startT3 = searchPlans({ base: ring.name, ilvl, start: mkRing({ affixes: [{ slot: 'prefix', group, modId: t3.modId, tier: 3 }] }), desired: [floored] }, deps)
console.log('\n--- floor goal test (≥T2 satisfied by T1/T2, not T3) ---')
console.log(`  start with T2 present ⇒ depth ${startT2.cheapestPlan?.depth} (0 = already met): ${startT2.cheapestPlan?.depth === 0}`)
console.log(`  start with T3 present ⇒ depth ${startT3.cheapestPlan?.depth} (>0 = must still produce): ${(startT3.cheapestPlan?.depth ?? 0) > 0}`)

// ── buy-side: the floored target's label drives the (text/pseudo-based) rare comparables ──
console.log('\n--- buy-side (floored label → rare-comparables filter; cheapest qualifying tier) ---')
console.log(`  floored desired.label = "${floored.label}" → estimateRarePriceLive prices comparables by this text (tier-or-better variant), not the exact-T1-only filter.`)

// ── default (no floor) unchanged: a no-floor modId target is exact-tier weight / pool ──
console.log('\n--- default (no floor) is unchanged ---')
console.log(`  P(no-floor modId ${t1.modId}) == exact T1 weight/pool: ${modRollProbability(idx, { affix: 'prefix', modId: t1.modId }) === pExactT1}`)

// ── resolver floor handle: resolveTargets returns per-tier candidates whose `tier` IS the floor knob ──
const cand = resolveTargets('maximum life', ring, ilvl, mods).filter(c => c.group === group && c.tier != null).sort((a, b) => a.tier - b.tier)
console.log('\n--- resolveTargets floor handle (candidate.tier → caller passes as minTier) ---')
console.log(`  ${cand.length} candidate(s) for group "${group}"; each carries .tier — the UI takes a candidate's tier as the floor:`)
for (const c of cand.slice(0, 4)) console.log(`    T${c.tier ?? '?'}  ${c.modId.padEnd(34)} ⇒ target { group:'${c.group}', minTier:${c.tier ?? '?'} }`)

console.log('\n⚠ Floor is opt-in: absent minTier ⇒ exact modId (parity byte-identical). Present ⇒ "group at tier ≥ floor". Confidence still propagates as the min over steps.')
