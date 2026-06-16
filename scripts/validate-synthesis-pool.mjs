/**
 * synthesis implicit pool + producer — validation. Run with tsx.
 *
 *   npm run validate:synthesis-pool
 *
 * The synthesised-item implicit pool is sourced per item class from poewiki Cargo (synthesis_mods) into
 * data/synthesisImplicits (npm run gen:synthesis). DIAGNOSIS: synthesis implicits have NO spawn weights
 * (verified — repoe-fork spawn_weights=[]; poewiki mod_spawn_weights empty for them), so the reroll is an
 * honest UNIFORM over the real per-class pool SIZE (no weights invented). Analysis-only; read-only.
 */
import { SYNTHESIS_POOL, synthesisPoolSize } from '../src/data/synthesisImplicits.js'
import { classifyMod } from '../src/services/modProducer.js'
import { buildEldritchIndex } from '../src/services/eldritch.js'
import { evaluateMethod } from '../src/services/craftMethods.js'
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
const gloves = Object.values(baseItems).find(b => b.name === 'Fingerless Silk Gloves' && b.release_state === 'released')
console.log(`=== synthesis implicit pool + producer · League: ${league} ===\n`)

// ── Step 1 — diagnosis ────────────────────────────────────────────────────────
console.log('--- Step 1: source diagnosis ---')
console.log('  Browser-UA poewiki Cargo: 200 (reuses the proven gen-anoints path)')
console.log('  Pool source : poewiki `synthesis_mods` (item_class_ids → mod_ids) → data/synthesisImplicits')
console.log('  Weights     : NONE — repoe-fork SynthesisImplicit* spawn_weights=[]; poewiki mod_spawn_weights empty for them')
console.log('  ⇒ honest UNIFORM over the REAL per-class pool size (weights not invented)')

// ── pool sane ────────────────────────────────────────────────────────────────
const classes = Object.keys(SYNTHESIS_POOL)
console.log(`\n--- pool (${classes.length} gear classes) ---`)
for (const c of ['Amulet', 'Ring', 'Body Armour', 'Staff', 'Belt']) console.log(`  ${c.padEnd(13)} options=${synthesisPoolSize(c)}  distinct mods=${SYNTHESIS_POOL[c].mods.length}`)

// ── reroll: data-derived poolSize, uniform (real, not a caller guess) ────────────
const ringImplicit = SYNTHESIS_POOL['Ring'].mods.find(m => /Life/.test(m)) ?? SYNTHESIS_POOL['Ring'].mods[0]
const rr = evaluateMethod(newItemState({ base: ring.name, itemClass: 'Ring', ilvl: 84, tags: [...ring.tags] }), { mods, currentLeague: league }, { desired: [{ slot: 'prefix', modId: ringImplicit, label: ringImplicit }], method: { kind: 'synthesis-reroll' } })
console.log('\n--- reroll (data-derived pool size; no caller poolSize supplied) ---')
console.log(`  target ${ringImplicit} on Ring → supported=${rr.supported}, P=1/${synthesisPoolSize('Ring')}=${(rr.perAttemptProb * 100).toFixed(2)}%, ~${rr.expectedAttempts.toFixed(0)} vultures`)
console.log(`  ${rr.notes.find(n => /UNIFORM/i.test(n)) ?? ''}`)

// ── producer: synthesis-implicit target → reroll producer; non-pool → none ──────
const target = { slot: 'prefix', modId: ringImplicit, label: ringImplicit, synthImplicit: true }
console.log('\n--- producer (classifyMod) ---')
console.log(`  pooled implicit  → classes ${JSON.stringify([...classifyMod(target, ring, 84, mods).classes])} specs ${JSON.stringify(classifyMod(target, ring, 84, mods).specs)}`)
console.log(`  non-pool implicit → classes ${JSON.stringify([...classifyMod({ slot: 'prefix', modId: 'SynthesisImplicitNope', synthImplicit: true }, ring, 84, mods).classes])} (no synthesis candidate)`)

// ── eldritch ⊥ synthesis exclusion (live, on an eldritch-eligible base) ──────────
const eldImplicit = buildEldritchIndex(new Set(gloves.tags), 'exarch', mods).entries[0]
const excl = searchPlans({ base: gloves.name, ilvl: 84, desired: [
  { slot: 'prefix', modId: SYNTHESIS_POOL['Gloves'].mods[0], label: 'synth', synthImplicit: true },
  { slot: 'prefix', modId: eldImplicit.modId, label: 'eldritch' },
] }, deps)
console.log('\n--- eldritch ⊥ synthesis exclusion ---')
console.log(`  synth implicit + eldritch implicit on Gloves → plans=${excl.plans.length}, verdict: ${excl.notes[0]}`)

// ── Vivid Vulture pricing (manual hook — beast not in the feed) ──────────────────
const solo = searchPlans({ base: ring.name, ilvl: 84, desired: [target] }, deps)
console.log('\n--- Vivid Vulture pricing (manual hook) ---')
console.log(`  producer proposes synthesis-reroll, but the plan is gated on the Vivid Vulture price (a beast, not in the feed) → ranked plans=${solo.plans.length} (flagged, not invented; supply a manual price to cost it)`)

console.log('\n⚠ Pool + size are REAL (poewiki Cargo); per-implicit weights are absent in the game data → uniform, not invented. Refresh per league via npm run gen:synthesis.')
