/**
 * modId-keyed targeting precision — validation. Run with tsx.
 *
 *   npm run validate:modid-targeting
 *
 * Targeting by stat/group conflates distinct mod IDENTITIES (an eldritch implicit vs a same-stat
 * explicit are different mods on different slots). resolveTargets returns the candidate modIds across
 * tiers/domains; targeting the modId removes the conflation (eldritch modId → eldritch route even when
 * a same-stat explicit is cheaper, because it's a DIFFERENT mod). Analysis-only; read-only.
 */
import { resolveTargets, classifyMod } from '../src/services/modProducer.js'
import { searchPlans } from '../src/services/solver.js'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName, getBenchOptions } from '../src/data/repoe.js'
import { normalizeBench } from '../src/services/benchCrafting.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'

const league = await resolveCurrentLeague()
const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions()])
const snapshot = await getEconomyProvider().getEconomySnapshot(league)
const deps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league }
const boots = Object.values(baseItems).find(b => b.name === 'Iron Greaves' && b.release_state === 'released')
const planUses = (p, re) => p && p.moves.some(m => re.test(m.label))
console.log(`=== modId-keyed targeting precision · League: ${league} ===\n`)

// ── resolver: ambiguous stat → multiple candidate modIds across domains/tiers ────
const ms = resolveTargets('increased Movement Speed', boots, 84, mods)
console.log('--- resolveTargets("increased Movement Speed", Iron Greaves) ---')
for (const c of ms) console.log(`  ${c.domain.padEnd(18)} ${c.modId.padEnd(34)} ${c.tier ? `T${c.tier} ` : ''}slot=${c.slot} :: ${c.label.replace(/\n/g, ' / ').slice(0, 40)}`)
const explicit = ms.find(c => c.domain === 'explicit')
const eldritch = ms.find(c => c.domain === 'eldritch-implicit')
console.log(`  ambiguous (≥2 distinct identities): ${ms.length >= 2} · has explicit + eldritch: ${!!explicit && !!eldritch}`)

// ── conflation fixed: target the ELDRITCH modId → eldritch route (not the cheaper explicit) ──
console.log('\n--- conflation fixed (target the eldritch-implicit modId) ---')
if (eldritch) {
  console.log(`  classifyMod(eldritch modId): ${[...classifyMod({ slot: eldritch.slot, modId: eldritch.modId }, boots, 84, mods).classes].join(',')}`)
  const r = searchPlans({ base: boots.name, ilvl: 84, desired: [{ slot: eldritch.slot, modId: eldritch.modId, label: 'eldritch MS' }] }, deps)
  console.log(`  cheapest: ${r.cheapestPlan?.moves.map(m => m.label).join(' → ')} · uses eldritch: ${planUses(r.cheapestPlan, /eldritch/i)} (explicit MS is cheaper but it's a DIFFERENT mod ⇒ not used)`)
}

// ── distinct identity: target the EXPLICIT modId → core/explicit route ───────────
console.log('\n--- distinct identity (target the explicit modId) ---')
if (explicit) {
  console.log(`  classifyMod(explicit modId): ${[...classifyMod({ slot: explicit.slot, modId: explicit.modId }, boots, 84, mods).classes].join(',')} (core)`)
  const r = searchPlans({ base: boots.name, ilvl: 84, desired: [{ slot: explicit.slot, modId: explicit.modId, label: 'explicit MS' }] }, deps)
  console.log(`  cheapest: ${r.cheapestPlan?.moves.map(m => m.label).join(' → ')} · uses eldritch: ${planUses(r.cheapestPlan, /eldritch/i)} (false — core/explicit route)`)
}

// ── pseudo/aggregate preserved: a stat spanning several contributing modIds ───────
const res = resolveTargets('Resistance', boots, 84, mods)
const resGroups = [...new Set(res.map(c => c.group))]
console.log('\n--- pseudo/aggregate preserved ("Resistance" → contributing modIds) ---')
console.log(`  ${res.length} candidate modIds across ${resGroups.length} groups: ${resGroups.slice(0, 6).join(', ')}… (a pseudo resolves to this SET, not one modId)`)

// ── resolver narrows domain: a single-domain stat → tiers of one identity ────────
const oneDomain = resolveTargets('increased Action Speed', boots, 84, mods)
const domains = [...new Set(oneDomain.map(c => c.domain))]
console.log('\n--- resolver: a single-domain stat → tiers of one identity (picker picks the tier) ---')
console.log(`  "increased Action Speed" → ${oneDomain.length} candidate(s) in domain(s): ${domains.join(', ')} (each a distinct tier/modId)`)

console.log('\n⚠ The UI per-mod picker emits the chosen modId; resolveTargets is the engine↔UI contract. Pricing keys on the modId\'s tier text (specific-variant buy-side).')
