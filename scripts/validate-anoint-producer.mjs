/**
 * anoint producer — diagnosis + validation. Run with tsx.
 *
 *   npm run validate:anoint-producer
 *
 * DIAGNOSIS: the notable→3-oil recipe table is NOT in any Code-fetchable export (PoB pob-data/poe1
 * has only Misc/Costs/ClusterJewels; the main repoe-fork base has no blight/oil/anoint file; PoB
 * computes anoints in code). It is Blight crafting data. So the table is GENERATED from the poewiki
 * Cargo data (npm run gen:anoints) into data/anointRecipes. This validates the PRODUCER seam: an anointable-notable
 * target → the anoint method with its fixed 3 oils, priced live; non-anointable → no candidate.
 * Analysis-only; read-only.
 */
import { classifyMod, resolveTargets } from '../src/services/modProducer.js'
import { ANOINT_RECIPES, isAnointableNotable } from '../src/data/anointRecipes.js'
import { searchPlans } from '../src/services/solver.js'
import { newItemState, withAnoint, openSlots } from '../src/services/itemState.js'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName, getBenchOptions } from '../src/data/repoe.js'
import { normalizeBench } from '../src/services/benchCrafting.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'

const league = await resolveCurrentLeague()
const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions()])
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const deps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league }
const amulet = Object.values(baseItems).find(b => b.name === 'Onyx Amulet' && b.release_state === 'released')
const ring = Object.values(baseItems).find(b => b.name === 'Two-Stone Ring' && b.release_state === 'released')
const notable = 'Whispers of Doom'
const ilvl = 84
const planUses = (p, re) => p && p.moves.some(m => re.test(m.label))
console.log(`=== anoint producer · League: ${league} ===\n`)

// ── Step 1 — diagnosis ────────────────────────────────────────────────────────
console.log('--- Step 1: source diagnosis ---')
console.log('  PoB pob-data/poe1/Misc.json   : present but monster/game constants only (no anoint)')
console.log('  pob-data/poe1/*               : only Costs.json + ClusterJewels.json; Oils/Anoints/Notables → 404')
console.log('  repoe-fork base               : blight_crafting_recipes/oils/anoints/enchantments → 404 (only cluster_jewel_notables = cluster data)')
console.log('  PoB community repo            : no oil/anoint/blight data file (anoints computed in code)')
console.log(`  ⇒ ABSENT from game exports → GENERATED from poewiki Cargo into data/anointRecipes (${Object.keys(ANOINT_RECIPES).length} recipes); refresh via npm run gen:anoints`)

// ── classifyMod: an anointable notable on an amulet → the anoint producer ────────
const target = { slot: 'prefix', modId: notable, label: notable, anoint: true }
const cls = classifyMod(target, amulet, ilvl, mods)
console.log('\n--- classifyMod (anointable notable on amulet) ---')
console.log(`  "${notable}" → classes: [${[...cls.classes].join(', ')}] · specs: ${JSON.stringify(cls.specs)}`)
console.log(`  is anoint producer: ${cls.classes.has('anoint')} · single fixed recipe ${JSON.stringify(ANOINT_RECIPES[notable])}`)

// ── anointable notable SOLVES → anoint method, fixed 3 oils, priced live, deterministic ──
const r = searchPlans({ base: amulet.name, ilvl, desired: [target] }, deps)
const plan = r.cheapestPlan
console.log('\n--- anointable notable solves (deterministic, 3 oils priced live) ---')
console.log(`  cheapest: ${plan?.moves.map(m => m.label).join(' → ')} · depth ${plan?.depth} · uses anoint: ${planUses(plan, /anoint/i)}`)
console.log(`  expectedChaos: ${plan?.expectedChaos?.toFixed(1)}c  p90: ${plan?.p90?.toFixed(1)}c  (deterministic ⇒ p90==expected: ${Math.abs((plan?.p90 ?? 0) - (plan?.expectedChaos ?? 0)) < 1e-6})`)

// ── slot model: the anoint sits in the enchant slot, NOT prefix/suffix capacity ──
const bare = newItemState({ base: amulet.name, itemClass: amulet.item_class, ilvl, tags: [...amulet.tags], rarity: 'rare' })
const anointed = withAnoint(bare, notable)
console.log('\n--- slot model (enchant slot, no affix-capacity collision) ---')
console.log(`  before: anoint=${bare.anoint ?? '(none)'}  open prefix=${openSlots(bare, 'prefix')} suffix=${openSlots(bare, 'suffix')}`)
console.log(`  after : anoint=${anointed.anoint}  open prefix=${openSlots(anointed, 'prefix')} suffix=${openSlots(anointed, 'suffix')}  (affix caps unchanged: ${openSlots(bare,'prefix')===openSlots(anointed,'prefix') && openSlots(bare,'suffix')===openSlots(anointed,'suffix')})`)
console.log(`  goal test: a present anoint satisfies the target ⇒ depth 0 when started anointed: ${searchPlans({ base: amulet.name, ilvl, start: anointed, desired: [target] }, deps).cheapestPlan?.depth === 0}`)

// ── non-anointable notable → NO anoint candidate (no false positive) ──────────────
const fakeNotable = 'Some Random Notable Not In The Table'
const noCls = classifyMod({ slot: 'prefix', modId: fakeNotable, label: fakeNotable, anoint: true }, amulet, ilvl, mods)
const noPlan = searchPlans({ base: amulet.name, ilvl, desired: [{ slot: 'prefix', modId: fakeNotable, label: fakeNotable, anoint: true }] }, deps)
console.log('\n--- non-anointable notable → no candidate (no false positive) ---')
console.log(`  classes: [${[...noCls.classes].join(', ')}] (anoint: ${noCls.classes.has('anoint')}) · seeded: ${isAnointableNotable(fakeNotable)} · plans found: ${noPlan.plans.length}`)

// ── non-amulet base → anoint rejected (amulet anoints only) ──────────────────────
const ringCls = classifyMod({ slot: 'prefix', modId: notable, label: notable, anoint: true }, ring, ilvl, mods)
console.log('\n--- non-amulet base (ring) → anoint rejected ---')
console.log(`  ${ring.name}: classes [${[...ringCls.classes].join(', ')}] (anoint: ${ringCls.classes.has('anoint')})  — ring anoints are a separate set (flagged, not modelled)`)

// ── oil pricing live (3 Golden Oils) + unpriced-oil note ──────────────────────────
console.log('\n--- oil pricing (live currency feed) ---')
console.log(`  recipe ${ANOINT_RECIPES[notable].join(' + ')} → plan cost ${plan?.expectedChaos?.toFixed(1)}c (3 oils, live; an unpriced oil is flagged, recipe kept)`)

// ── resolveTargets note: notables are not in affix pools (UI anoint resolver is separate) ──
const rt = resolveTargets(notable.toLowerCase(), amulet, ilvl, mods)
console.log('\n--- resolveTargets (affix resolver) ---')
console.log(`  "${notable}" → ${rt.length} affix candidate(s) (notables aren't affixes; the anoint target is named directly with anoint:true — a separate UI resolver, flagged follow-up)`)

console.log('\n⚠ Recipe table is GENERATED from poewiki Cargo (not invented/hand-typed) — deterministic recipes ship low-confidence until a sample is spot-checked vs the live game. Refresh per league via npm run gen:anoints.')
