/**
 * Eldritch implicits — validation (first Tier-1 coverage module). Run with tsx.
 *
 *   npm run validate:eldritch
 *
 * Demonstrates, live: (1) cost to roll a NAMED Exarch + Eater implicit on a real eligible base
 * via the resolved-weight index; (2) eligibility reject on influenced/corrupted items (eldritch
 * ⊥ influence surfaced); (3) dominance orbs target the correct side (Exarch⇒prefix, Eater⇒suffix)
 * wired into the explicit model; (4) currencies priced live + Orb-of-Conflict EV (flagged).
 * Analysis-only; read-only.
 */
import { getMods, getBaseItems } from '../src/data/repoe.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { buildEldritchIndex, eldritchRollProbability, eldritchEligibility, orbOfConflictEV } from '../src/services/eldritch.js'
import { resolveBaseModIndex } from '../src/services/modWeightIndex.js'
import { newItemState } from '../src/services/itemState.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'

const league = await resolveCurrentLeague()
const [mods, bases] = await Promise.all([getMods(), getBaseItems()])
const snap = await getEconomyProvider().getEconomySnapshot(league)
const divine = searchEconomy(snap, 'Divine Orb', 'currency', 1)[0]?.chaosValue ?? null
const div = (c) => (c == null ? '—' : `${c.toFixed(0)}c${divine ? ` (${(c / divine).toFixed(2)} div)` : ''}`)
const price = (n) => searchEconomy(snap, n, 'currency', 1)[0]?.chaosValue ?? null

const boots = Object.values(bases).find(b => b.name === 'Iron Greaves' && b.release_state === 'released')
console.log(`=== Eldritch implicits validation — ${boots.name} (ilvl 84) · League: ${league} ===\n`)

// ── (4) currencies priced live ─────────────────────────────────────────────────
console.log('--- currencies (live) ---')
for (const n of ['Lesser Eldritch Ember', 'Exceptional Eldritch Ember', 'Lesser Eldritch Ichor', 'Exceptional Eldritch Ichor', 'Eldritch Exalted Orb', 'Eldritch Chaos Orb', 'Eldritch Annulment Orb', 'Orb of Conflict']) {
  console.log(`  ${n.padEnd(28)} ${price(n) == null ? 'NOT TRACKED (manual price needed)' : div(price(n))}`)
}

// ── (1) CORE — cost to roll a NAMED Exarch + Eater implicit (index-derived) ──────
console.log('\n--- (1) roll a NAMED implicit (weight/pool, priced live) ---')
const exIdx = buildEldritchIndex(new Set(boots.tags), 'exarch', mods)
const eaIdx = buildEldritchIndex(new Set(boots.tags), 'eater', mods)
console.log(`  Exarch pool: ${exIdx.entries.length} rows / ${exIdx.groups} groups · Eater pool: ${eaIdx.entries.length} rows / ${eaIdx.groups} groups`)
const targets = [
  { side: 'Exarch', slot: 'prefix', group: 'MovementVelocity', label: 'increased Movement Speed', idx: exIdx },
  { side: 'Eater', slot: 'suffix', group: 'LifeRegenerationRate', label: 'increased Life Regeneration rate', idx: eaIdx },
]
for (const t of targets) {
  const p = eldritchRollProbability(t.idx, { group: t.group })
  const r = await estimateCraftCostLive({ baseName: boots.name, ilvl: 84, desired: [{ slot: t.slot, group: t.group, label: t.label }], method: { kind: 'eldritch-implicit' } }, league)
  console.log(`  ${t.side} "${t.label}" (${t.group}): P=${(p * 100).toFixed(2)}% ⇒ ~${r.expectedAttempts.toFixed(1)} ${t.side === 'Exarch' ? 'Exceptional Embers' : 'Exceptional Ichors'} ⇒ ${div(r.totalChaos)}  [supported=${r.supported}]`)
}
// practical lower-tier path (same type-hit on the cheap ember; flagged subset)
const cheap = await estimateCraftCostLive({ baseName: boots.name, ilvl: 84, desired: [{ slot: 'prefix', group: 'MovementVelocity', label: 'Movement Speed' }], method: { kind: 'eldritch-implicit', tier: 'lesser' } }, league)
console.log(`  practical: same type-hit priced at LESSER ember ⇒ ${div(cheap.totalChaos)} (⚠ subset pool — can't reach top value; then Orb-of-Conflict walk)`)

// ── (2) eligibility reject — eldritch ⊥ influence + corrupted ───────────────────
console.log('\n--- (2) eligibility (eldritch ⊥ influence) ---')
const infl = await estimateCraftCostLive({ baseName: boots.name, ilvl: 84, influence: ['shaper'], desired: [{ slot: 'prefix', group: 'MovementVelocity', label: 'MS' }], method: { kind: 'eldritch-implicit' } }, league)
console.log(`  influenced (shaper): supported=${infl.supported} — ${infl.reason}`)
const corr = await estimateCraftCostLive({ baseName: boots.name, ilvl: 84, corrupted: true, desired: [{ slot: 'prefix', group: 'MovementVelocity', label: 'MS' }], method: { kind: 'eldritch-implicit' } }, league)
console.log(`  corrupted: supported=${corr.supported} — ${corr.reason}`)
// direct eligibility primitive on a non-eldritch base (e.g. a ring)
const ringElig = eldritchEligibility(newItemState({ base: 'x', itemClass: 'Ring', ilvl: 84, tags: ['ring', 'default'] }))
console.log(`  non-eligible base (ring): ok=${ringElig.ok} — ${ringElig.reason}`)

// ── (3) dominance orbs target the correct side (wired into explicit model) ──────
console.log('\n--- (3) dominance orbs (Exarch⇒prefix, Eater⇒suffix) ---')
const affixes = [
  { slot: 'prefix', group: 'P1', modId: 'P1', label: 'a prefix' },
  { slot: 'prefix', group: 'P2', modId: 'P2', label: 'another prefix' },
  { slot: 'suffix', group: 'S1', modId: 'S1', label: 'a suffix' },
]
for (const dom of ['exarch', 'eater']) {
  const r = await estimateCraftCostLive({ baseName: boots.name, ilvl: 84, desired: [], affixes, method: { kind: 'eldritch-annul', dominant: dom } }, league)
  console.log(`  annul (dominant ${dom}): ${r.method} · P(specific)/orb ${(r.perAttemptProb * 100).toFixed(0)}% · ${r.notes[0]}`)
}
// exalt = targeted ADD on the dominant (explicit) side — pull a real explicit prefix from the index
const explicitIdx = resolveBaseModIndex(boots, mods, 84)
const realPrefix = explicitIdx.prefixes.sort((a, b) => a.tier - b.tier || b.weight - a.weight)[0]
const exalt = await estimateCraftCostLive({ baseName: boots.name, ilvl: 84, desired: [{ slot: 'prefix', group: realPrefix.group, label: realPrefix.text }], method: { kind: 'eldritch-exalt', dominant: 'exarch' } }, league)
console.log(`  exalt (dominant exarch ⇒ prefix) → "${realPrefix.text}": ${exalt.method} · P=${(exalt.perAttemptProb * 100).toFixed(2)}% ⇒ ${div(exalt.totalChaos)}`)

// ── Orb-of-Conflict tier-walk (FLAGGED representative) ──────────────────────────
console.log('\n--- Orb-of-Conflict tier-walk (⚠ flagged representative, NOT simulated) ---')
const conflict = orbOfConflictEV(4, 1) // walk a tier-4 implicit up to tier-1
const ocPrice = price('Orb of Conflict')
console.log(`  walk tier 4→1: ~${conflict.orbs} Orbs of Conflict ⇒ ${div(ocPrice == null ? null : conflict.orbs * ocPrice)}  (${conflict.note})`)

console.log('\n⚠ Pool = full (Exceptional currency). Lower currency tiers roll a SUBSET; the currency→tier map is not in the export.')
console.log('⚠ Value-variant (Unique/Pinnacle presence) scaling excluded — base values only. Eldritch Annulment Orb is not price-tracked.')
