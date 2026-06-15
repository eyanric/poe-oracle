/**
 * Synthesis — validation (Tier-2). Run with tsx.
 *
 *   npm run validate:synthesis
 *
 * CORRECTED mechanic: the league Synthesiser FUSION is gone. Core = Harvest "synthesise" transform
 * + Beast (Vivid Vulture) reroll. Shows, live: synthesise lifeforce cost + count rule + eligibility;
 * the Vivid Vulture reroll keep-trying structure; and the DATA GAP (the implicit pool isn't in the
 * export). Analysis-only; read-only.
 */
import { getBaseItems } from '../src/data/repoe.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { expectedImplicitCount, IMPLICIT_COUNT_DIST } from '../src/services/synthesis.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'

const league = await resolveCurrentLeague()
const bases = await getBaseItems()
const snap = await getEconomyProvider().getEconomySnapshot(league)
const divine = searchEconomy(snap, 'Divine Orb', 'currency', 1)[0]?.chaosValue ?? null
const div = (c) => (c == null ? '—' : `${c.toFixed(0)}c${divine ? ` (${(c / divine).toFixed(2)} div)` : ''}`)

const ring = Object.values(bases).find(b => b.name === 'Two-Stone Ring' && b.release_state === 'released')
console.log(`=== Synthesis validation — ${ring.name} · League: ${league} ===\n`)
console.log('⚠ CORRECTION: league Synthesiser FUSION removed. Core = Harvest synthesise + Vivid Vulture reroll (arity-1).')
console.log('⚠ DATA GAP: synthesis_a/globals/bonus domains are MAP/Memory mods, NOT gear implicits; the item-implicit pool is not in repoe-fork.\n')

console.log('--- lifeforce (live) ---')
console.log(`  Vivid Crystallised Lifeforce ${div(searchEconomy(snap, 'Vivid Crystallised Lifeforce', 'currency', 1)[0]?.chaosValue)} · Sacred Crystallised Lifeforce ${div(searchEconomy(snap, 'Sacred Crystallised Lifeforce', 'currency', 1)[0]?.chaosValue)}`)

// ── (1) Harvest synthesise transform (deterministic, priced live) ───────────────
console.log('\n--- (1) Harvest synthesise transform ---')
const synth = await estimateCraftCostLive({ baseName: ring.name, ilvl: 84, desired: [], method: { kind: 'synthesise' } }, league)
console.log(`  ${synth.method}: ${synth.consumables.map(c => `${c.qty}× ${c.name}`).join(' + ')} ⇒ ${div(synth.totalChaos)} · risk ${synth.risk?.category ?? '—'} · P ${(synth.perAttemptProb * 100).toFixed(0)}%`)
console.log(`  implicit count dist (datamined, flagged): ${Object.entries(IMPLICIT_COUNT_DIST).map(([n, p]) => `${n}:${(p * 100)}%`).join(' · ')} ⇒ E≈${expectedImplicitCount.toFixed(2)}`)
for (const n of synth.notes) console.log(`    ${n}`)

// ── (2) eligibility rejects ─────────────────────────────────────────────────────
console.log('\n--- (2) eligibility ---')
const infl = await estimateCraftCostLive({ baseName: ring.name, ilvl: 84, influence: ['shaper'], desired: [], method: { kind: 'synthesise' } }, league)
console.log(`  influenced: supported=${infl.supported} — ${infl.reason}`)
const corr = await estimateCraftCostLive({ baseName: ring.name, ilvl: 84, corrupted: true, desired: [], method: { kind: 'synthesise' } }, league)
console.log(`  corrupted: supported=${corr.supported} — ${corr.reason}`)
console.log(`  (fractured reject also covered by synthesiseEligibility — see tests)`)

// ── (3) Vivid Vulture reroll (keep-trying; pool-gap flagged) ─────────────────────
console.log('\n--- (3) Beast (Vivid Vulture) reroll — keep-trying ---')
const noPool = await estimateCraftCostLive({ baseName: ring.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'SomeSynthImplicit', label: 'a synthesis implicit' }], method: { kind: 'synthesis-reroll' } }, league)
console.log(`  without poolSize: supported=${noPool.supported} — ${noPool.reason}`)
const withPool = await estimateCraftCostLive({ baseName: ring.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'SomeSynthImplicit', label: 'a synthesis implicit' }], method: { kind: 'synthesis-reroll', poolSize: 20 } }, league)
console.log(`  with poolSize=20 (flagged): P ${(withPool.perAttemptProb * 100).toFixed(1)}% ⇒ ~${withPool.expectedAttempts.toFixed(0)} Vivid Vultures ⇒ ${div(withPool.totalChaos)} (Vivid Vulture unpriced → manual)`)
for (const n of withPool.notes) console.log(`    ${n}`)

console.log('\n⚠ P(desired) needs the per-base synthesis implicit list (NOT in the export) — source from poedb; the reroll uses a flagged uniform 1/poolSize until then.')
console.log('⚠ Harvest synthesise cost (5000 Vivid + 1 Sacred) + count dist (75/19/6) are sourced/datamined — verify against the live game.')
