/**
 * Path Solver — increment 1 (spine) validation. Run with tsx.
 *
 *   npm run validate:solver
 *
 * Hits the 9 validation rows: deterministic-cheap-first, producibility gate, goal test, encapsulated
 * recipe as a candidate, craft-vs-buy, specific-variant buy-side, confidence propagation, canonical
 * key stability. Analysis-only; read-only. (Multi-step search is the NEXT increment.)
 */
import { solve, solveLive } from '../src/services/solver.js'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName, getBenchOptions } from '../src/data/repoe.js'
import { normalizeBench } from '../src/services/benchCrafting.js'
import { newItemState, stateKey } from '../src/services/itemState.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

const league = await resolveCurrentLeague()
const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions()])
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const deps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league }
console.log(`=== Path Solver (spine) validation · League: ${league} ===\n`)

const show = (r, n = 5) => r.paths.filter(p => p.supported).slice(0, n).map(p => `${p.title}${p.kind === 'recipe' ? '(recipe)' : ''} ${p.expectedChaos?.toFixed(0)}c[${p.confidence}]`).join(' · ')

// ── (1) deterministic-cheap-first: benchable life → bench, never a ladder ────────
const ring = Object.values(baseItems).find(b => b.name === 'Two-Stone Ring' && b.release_state === 'released')
const lifeTarget = { base: ring.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'maximum Life' }] }
const r1 = solve(lifeTarget, deps)
console.log('--- (1) deterministic-cheap-first (ring + maximum Life) ---')
console.log(`  ranked: ${show(r1)}`)
console.log(`  cheapest: ${r1.cheapest?.title} (kind=${r1.cheapest?.kind}) — bench beats stochastic: ${r1.cheapest?.id.includes('bench') || r1.cheapest?.id.includes('essence')}`)

// ── (2) producibility gate: a body-armour-only mod on a ring ────────────────────
const r2 = solve({ base: ring.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'LocalPhysicalDamagePercent', label: 'increased Physical Damage' }] }, deps)
console.log('\n--- (2) producibility gate (local phys% on a ring — weapon-only, cannot roll) ---')
console.log(`  supported paths: ${r2.paths.filter(p => p.supported).length} (expect 0) · all excluded, not mis-costed: ${r2.paths.every(p => !p.supported)}`)

// ── (3)+(4)+(7) encapsulated recipe + goal + confidence: shield 3p2s ────────────
const shield = Object.values(baseItems).find(b => b.name === 'Titanium Spirit Shield' && b.release_state === 'released')
const shieldTarget = {
  base: shield.name, ilvl: 84, desired: [
    { slot: 'prefix', group: 'SpellBlockPercentage', label: 'Chance to Block Spell Damage' },
    { slot: 'prefix', group: 'IncreasedShieldBlockPercentage', label: 'increased Chance to Block' },
    { slot: 'prefix', group: 'BaseLocalDefences', label: 'maximum Energy Shield' },
    { slot: 'suffix', group: 'AllResistances', label: 'all Elemental Resistances' },
    { slot: 'suffix', group: 'ColdResistance', label: 'Cold Resistance' },
  ],
}
const r3 = solve(shieldTarget, deps)
console.log('\n--- (3)/(4)/(7) shield 3p2s — encapsulated recipe + confidence propagation ---')
console.log(`  ranked: ${show(r3, 6) || '(no single method reaches 5 mods)'}`)
const recipe = r3.paths.find(p => p.kind === 'recipe')
console.log(`  NNN ladder recipe present: ${!!recipe} ⇒ ${recipe?.expectedChaos?.toFixed(0)}c [conf=${recipe?.confidence}]`)
console.log(`  confidence propagated (flags): ${recipe?.flags.join(' | ')}`)

// ── (5) abstract rejected ───────────────────────────────────────────────────────
const r5 = solve({ base: ring.name, ilvl: 84, desired: [{ slot: 'prefix', label: 'any prefix' }] }, deps)
console.log('\n--- abstract target rejected ---')
console.log(`  cheapest=${r5.cheapest} · verdict=${r5.verdict.rationale}`)

// ── (8) canonical key stability ─────────────────────────────────────────────────
console.log('\n--- (8) canonical key (stable, order-independent) ---')
const a = newItemState({ base: 'X', itemClass: 'Ring', ilvl: 84, tags: ['ring'], affixes: [{ slot: 'prefix', group: 'A', modId: 'A1' }, { slot: 'suffix', group: 'B', modId: 'B1' }] })
const b = newItemState({ base: 'X', itemClass: 'Ring', ilvl: 84, tags: ['ring'], affixes: [{ slot: 'suffix', group: 'B', modId: 'B1' }, { slot: 'prefix', group: 'A', modId: 'A1' }] })
console.log(`  same state ⇒ same key: ${stateKey(a) === stateKey(b)} · key="${stateKey(a).slice(0, 60)}…"`)

// ── (5)+(6) craft-vs-buy + specific-variant buy-side (live) ─────────────────────
console.log('\n--- (5)/(6) craft-vs-buy + specific-variant buy-side (live trade) ---')
const live = await solveLive(lifeTarget, league)
console.log(`  cheapest: ${live.cheapest?.title} ≈ ${live.cheapest?.expectedChaos?.toFixed(0)}c`)
console.log(`  buy-side (specific variant): ${live.buySide ? `${live.buySide.lowChaos.toFixed(0)}–${live.buySide.medianChaos.toFixed(0)}c [${live.buySide.confidence}]` : 'unpriced (flagged)'}`)
console.log(`  verdict: ${live.verdict.decision} (${live.verdict.confidence}) — ${live.verdict.rationale}`)

console.log('\n⚠ Increment 1 = single-method/recipe ranked spine. Multi-step cross-module sequencing is the NEXT increment (canonical key + compositional cost are the seams).')
