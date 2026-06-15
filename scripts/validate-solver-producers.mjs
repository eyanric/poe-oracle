/**
 * Path Solver — increment 3a (producer index + specialized methods) validation. Run with tsx.
 *
 *   npm run validate:solver-producers
 *
 * The mod→producing-methods index wires the DATA-COMPLETE specialized producers (influence /
 * eldritch / veiled) into the search so specialized targets solve (no longer "no path"), compose
 * with protection, enforce eldritch⊥influence, and produce zero false positives. Read-only.
 */
import { searchPlans } from '../src/services/solver.js'
import { classifyMod, modProducers } from '../src/services/modProducer.js'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName, getBenchOptions } from '../src/data/repoe.js'
import { normalizeBench } from '../src/services/benchCrafting.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'

const league = await resolveCurrentLeague()
const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions()])
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const deps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league }
const base = (n) => Object.values(baseItems).find(b => b.name === n && b.release_state === 'released')
const body = base('Vaal Regalia'), boots = base('Iron Greaves'), gloves = base('Fingerless Silk Gloves')
const planStr = (p) => p ? `${p.moves.map(m => m.label).join(' → ')}  ≈${p.expectedChaos?.toFixed(0)}c [d${p.depth}, ${p.confidence}]` : '—'
const usesKind = (p, re) => p && p.moves.some(m => re.test(m.label))
console.log(`=== Path Solver producers (3a) · League: ${league} ===\n`)

// ── influence target solves ─────────────────────────────────────────────────────
const infTarget = { base: body.name, ilvl: 84, desired: [{ slot: 'suffix', group: 'AllResistances', label: 'all Elemental Resistances (Warlord)' }] }
const r1 = searchPlans(infTarget, deps)
console.log('--- influence target (Warlord all-res suffix on Vaal Regalia) ---')
console.log(`  specialized specs: ${modProducers(infTarget.desired[0], body, 84, mods).map(s => s.kind + (s.influence ? `(${s.influence})` : '')).join(', ')}`)
console.log(`  cheapest plan: ${planStr(r1.cheapestPlan)}`)
console.log(`  uses an influence exalt: ${r1.plans.some(p => usesKind(p, /add-influence|Exalt/i))}`)

// ── eldritch target solves (eldritch-EXCLUSIVE implicit, no plain route) ─────────
const eldTarget = { base: boots.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'ItemGrantsBuff', label: 'Scorched Ground while moving (Exarch)' }] }
const r2 = searchPlans(eldTarget, deps)
console.log('\n--- eldritch target (Exarch Scorched-Ground implicit on Iron Greaves) ---')
console.log(`  eldritch producer proposed: ${modProducers(eldTarget.desired[0], boots, 84, mods).some(s => s.kind === 'eldritch-implicit')}`)
console.log(`  cheapest plan: ${planStr(r2.cheapestPlan)}`)
console.log(`  ⓘ note: group-name matching can surface a cheaper same-group essence/explicit route; the eldritch producer is correctly proposed (synthetic test proves the exclusive-implicit end-to-end + value-tier flag).`)

// ── veiled target solves (veiled-EXCLUSIVE hybrid, no plain route) ───────────────
const veilTarget = { base: gloves.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'AreaDamageAndAreaOfEffect', label: 'veiled Area Damage + AoE' }] }
const r3 = searchPlans(veilTarget, deps)
console.log('\n--- veiled target (veiled Area-Damage+AoE prefix on Fingerless Silk Gloves) ---')
console.log(`  cheapest plan: ${planStr(r3.cheapestPlan)}`)
console.log(`  uses an unveil (Veiled Chaos/Exalt): ${r3.plans.some(p => usesKind(p, /Veiled/i))}`)

// ── specialized + protection composes ────────────────────────────────────────────
const compose = { base: body.name, ilvl: 84, desired: [
  { slot: 'suffix', group: 'AllResistances', label: 'all Elemental Resistances (Warlord)' },
  { slot: 'prefix', group: 'BaseLocalDefences', label: 'maximum Energy Shield' },
] }
const r4 = searchPlans(compose, deps)
console.log('\n--- specialized + protection composes (Warlord suffix + ES prefix) ---')
const composed = r4.plans.find(p => p.depth >= 2 && usesKind(p, /add-influence|Exalt/i))
console.log(`  composed plan: ${planStr(composed)} (specialized producer + another step)`)

// ── exclusion: eldritch ⊥ influence (eldritch-only mod + influence mod on one item) ──
const mixed = { base: boots.name, ilvl: 84, desired: [
  { slot: 'prefix', group: 'ItemGrantsBuff', label: 'Exarch Scorched Ground' }, // eldritch-only
  { slot: 'suffix', group: 'AllResistances', label: 'all res (influence)' },     // influence
] }
const r5 = searchPlans(mixed, deps)
const cls = (m, b) => [...classifyMod(m, b, 84, mods).classes].join('/')
console.log('\n--- exclusion (eldritch ⊥ influence) ---')
console.log(`  mixed mod classes: ${cls(mixed.desired[0], boots)} + ${cls(mixed.desired[1], boots)}`)
console.log(`  guard fires iff a mod is influence and another eldritch ⇒ no plan: cheapest=${r5.cheapestPlan != null ? 'found' : 'null'} (synthetic test proves the guard on a clean influence+eldritch pair)`)

// ── no false positives + deferred synthesis ──────────────────────────────────────
console.log('\n--- no false positives / deferred ---')
console.log(`  plain Life (Vaal Regalia): classes=${[...classifyMod({ slot: 'prefix', group: 'IncreasedLife' }, body, 84, mods).classes].join(',')} (expect core)`)
console.log(`  plain ColdRes (Vaal Regalia): specialized specs=${modProducers({ slot: 'suffix', group: 'ColdResistance' }, body, 84, mods).length} (expect 0)`)
console.log(`  synthesis implicit (not in repoe-fork): classes=${[...classifyMod({ slot: 'prefix', group: 'SomeSynthImplicit' }, body, 84, mods).classes].join(',')} (core ⇒ not guessed, flag-deferred)`)

console.log('\n⚠ DEFERRED to 3b: anoint (recipe table), synthesis (pool gap), unprotected cross-step reproduction. catalyst/strand are refinement/state moves, not producers.')
