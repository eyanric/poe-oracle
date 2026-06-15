/**
 * Path Solver — increment 2 (multi-step search) validation. Run with tsx.
 *
 *   npm run validate:solver-multistep
 *
 * Protect-then-proceed: build one side, lock it, roll the other (locks respected ⇒ no cross-step
 * reproduction). Hits the rows: protect found + exploited, multi-step beats single, no regression,
 * deterministic-cheap-first, branch-and-bound/termination, memoization, confidence. Read-only.
 */
import { searchPlans, solve } from '../src/services/solver.js'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName, getBenchOptions } from '../src/data/repoe.js'
import { normalizeBench } from '../src/services/benchCrafting.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'

const league = await resolveCurrentLeague()
const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions()])
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const deps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league }
console.log(`=== Path Solver multi-step (protect-then-proceed) · League: ${league} ===\n`)

const planStr = (p) => p ? `${p.moves.map(m => m.label).join(' → ')}  ≈${p.expectedChaos?.toFixed(0)}c [d${p.depth}, ${p.confidence}]` : '—'

// ── prefix + suffix target: protect-then-proceed should appear; multi-step beats single ──
const body = Object.values(baseItems).find(b => b.name === 'Vaal Regalia' && b.release_state === 'released')
const target = { base: body.name, ilvl: 84, desired: [
  { slot: 'prefix', group: 'AttackerTakesDamageNoRange', label: 'Reflect Physical to Attackers' }, // rollable, not benchable
  { slot: 'suffix', group: 'EnergyShieldDelay', label: 'faster start of ES Recharge' },            // rollable, not benchable
] }
const r = searchPlans(target, deps)
console.log('--- prefix + suffix (Vaal Regalia, both non-benchable) ---')
r.plans.slice(0, 5).forEach((p, i) => console.log(`  ${i + 1}. ${planStr(p)}`))
const protectPlan = r.plans.find(p => p.depth >= 2) // build one side, then add the other without destroying it
const lockPlan = r.plans.find(p => p.moves.some(m => m.kind === 'lock'))
console.log(`  protect-then-proceed plan FOUND (multi-step, second mod added without destroying the first): ${!!protectPlan}${protectPlan ? ` ⇒ ${planStr(protectPlan)}` : ''}`)
console.log(`  explicit metamod-lock plan also in search space: ${!!lockPlan} (dominated by add-only slam here — a 2-div lock isn't worth paying when a slam protects for ~5c)`)
console.log(`  cheapest plan: ${planStr(r.cheapestPlan)} (depth ${r.cheapestPlan?.depth})`)
// multi-step beats single: compare cheapest plan vs best SINGLE method (depth-1 spine)
const single = solve(target, deps).cheapest
console.log(`  best single method (spine): ${single?.title} ≈${single?.expectedChaos?.toFixed(0)}c · multi-step cheaper: ${(r.cheapestPlan?.rankChaos ?? Infinity) <= (single?.rankChaos ?? Infinity)}`)
console.log(`  search: ${r.search.nodes} nodes · memo hits ${r.search.memoHits} · pruned ${r.search.pruned} (depth≤${r.search.depthCap}, beam ${r.search.beamWidth}) — terminated ✓`)

// ── no regression: a single benchable mod → depth-1 single move ─────────────────
const ring = Object.values(baseItems).find(b => b.name === 'Two-Stone Ring' && b.release_state === 'released')
const r2 = searchPlans({ base: ring.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'maximum Life' }] }, deps)
const spine = solve({ base: ring.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'maximum Life' }] }, deps)
console.log('\n--- no regression (ring + maximum Life) ---')
console.log(`  cheapest plan: ${planStr(r2.cheapestPlan)} · depth ${r2.cheapestPlan?.depth} (expect 1, no padding)`)
console.log(`  matches spine depth-1 single method: ${r2.cheapestPlan?.depth === 1 && r2.cheapestPlan?.moves[0].label === spine.cheapest?.title}`)

// ── memoization + termination on cycles (scour can't loop) ──────────────────────
console.log('\n--- termination / memoization (scour move present, cannot loop) ---')
console.log(`  search completed in ${r.search.nodes} nodes with ${r.search.memoHits} memo hits (scour returns to start key ⇒ pruned)`)

// ── confidence propagation: shield 3p2s recipe plan carries flags ───────────────
const shield = Object.values(baseItems).find(b => b.name === 'Titanium Spirit Shield' && b.release_state === 'released')
const r3 = searchPlans({ base: shield.name, ilvl: 84, desired: [
  { slot: 'prefix', group: 'SpellBlockPercentage', label: 'Chance to Block Spell Damage' },
  { slot: 'prefix', group: 'IncreasedShieldBlockPercentage', label: 'increased Chance to Block' },
  { slot: 'prefix', group: 'BaseLocalDefences', label: 'maximum Energy Shield' },
  { slot: 'suffix', group: 'AllResistances', label: 'all Elemental Resistances' },
  { slot: 'suffix', group: 'ColdResistance', label: 'Cold Resistance' },
] }, deps)
console.log('\n--- confidence propagation (shield 3p2s) ---')
console.log(`  cheapest plan: ${planStr(r3.cheapestPlan)}`)
console.log(`  flags propagated: ${r3.cheapestPlan?.flags.join(' | ') || '(none)'}`)

// ── abstract rejected ───────────────────────────────────────────────────────────
const r4 = searchPlans({ base: ring.name, ilvl: 84, desired: [{ slot: 'prefix', label: 'any prefix' }] }, deps)
console.log('\n--- abstract rejected ---')
console.log(`  cheapestPlan=${r4.cheapestPlan} · ${r4.verdict.rationale}`)

console.log('\n⚠ Protected plans only — unprotected cross-step reproduction + specialized-method context are increment 3 (returned plans are a safe upper bound).')
