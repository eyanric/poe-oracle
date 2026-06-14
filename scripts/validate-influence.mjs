/**
 * Influence crafting — validation (Tier-1 #2). Run with tsx.
 *
 *   npm run validate:influence
 *
 * Demonstrates, live: (1) add a NAMED influenced mod via the correct exalt on a no-influence base
 * (weight-index on the influence-gated pool); (2) Awakener's Orb through the arity-2 channel (carry
 * one influenced mod from each input); (3) Orb of Dominance elevate probability + collateral; (4)
 * eligibility reuse (influence ⊥ eldritch via shared isInfluenced). Analysis-only; read-only.
 */
import { getMods, getBaseItems } from '../src/data/repoe.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { buildInfluenceIndex, influenceRollProbability } from '../src/services/influence.js'
import { evaluateInputs } from '../src/services/craftMethods.js'
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

const body = Object.values(bases).find(b => b.name === 'Vaal Regalia' && b.release_state === 'released')
console.log(`=== Influence crafting validation — ${body.name} (ilvl 86) · League: ${league} ===\n`)

console.log('--- currencies (live) ---')
for (const n of ["Shaper's Exalted Orb", "Elder's Exalted Orb", "Hunter's Exalted Orb", "Warlord's Exalted Orb", "Awakener's Orb", 'Orb of Dominance']) {
  console.log(`  ${n.padEnd(22)} ${price(n) == null ? 'NOT TRACKED' : div(price(n))}`)
}

// ── (1) add a NAMED influenced mod via the correct exalt ────────────────────────
console.log('\n--- (1) add a NAMED influenced mod (weight/pool × live exalt) ---')
const hunterIdx = buildInfluenceIndex(new Set(body.tags), 'hunter', 86, mods)
const pLife = influenceRollProbability(hunterIdx, { group: 'MaximumLifeIncreasePercent' })
console.log(`  Hunter pool: ${hunterIdx.prefixes.length}p + ${hunterIdx.suffixes.length}s · Σ${hunterIdx.total}`)
const add = await estimateCraftCostLive({ baseName: body.name, ilvl: 86, influence: [], desired: [{ slot: 'prefix', group: 'MaximumLifeIncreasePercent', label: 'increased maximum Life (Hunter)' }], method: { kind: 'add-influence', influence: 'hunter' } }, league)
console.log(`  Hunter "+% maximum Life": P=${(pLife * 100).toFixed(2)}% ⇒ ~${add.expectedAttempts.toFixed(1)} Hunter's Exalts ⇒ ${div(add.totalChaos)}  [supported=${add.supported}]`)

// ── (2) Awakener's Orb (arity-2 channel) — carry one influenced mod from each ────
console.log("\n--- (2) Awakener's Orb (arity-2 channel: carry one influenced mod per input) ---")
const data = { mods, currentLeague: league }
const donorHunter = newItemState({ base: body.name, itemClass: body.item_class, ilvl: 86, tags: [...body.tags], influence: ['hunter'], affixes: [{ slot: 'prefix', group: 'MaximumLifeIncreasePercent', modId: 'MaximumLifeBodyInfluence2_', influenced: true }] })
const donorWarlord = newItemState({ base: body.name, itemClass: body.item_class, ilvl: 86, tags: [...body.tags], influence: ['warlord'], affixes: [{ slot: 'suffix', group: 'AllResistances', modId: 'AllResistancesInfluence2_', influenced: true }] })
const aw = evaluateInputs([donorHunter, donorWarlord], data, {
  desired: [{ slot: 'prefix', group: 'MaximumLifeIncreasePercent', label: 'Hunter +%Life' }, { slot: 'suffix', group: 'AllResistances', label: 'Warlord all-res' }],
  method: { kind: 'awakeners' },
})
const awPrice = price("Awakener's Orb")
console.log(`  single-influenced-mod donors (Hunter +%Life × Warlord all-res): P(carry both)=${(aw.perAttemptProb * 100).toFixed(0)}% ⇒ ${aw.expectedAttempts.toFixed(1)} Awakener's Orb ⇒ ${div(awPrice == null ? null : aw.expectedAttempts * awPrice)} (+2 donor items)`)
console.log(`  ${aw.notes[0]}`)
// multi-influenced donor: carry is random ⇒ P < 1
const donorMulti = newItemState({ base: body.name, itemClass: body.item_class, ilvl: 86, tags: [...body.tags], influence: ['hunter'], affixes: [{ slot: 'prefix', group: 'MaximumLifeIncreasePercent', modId: 'X', influenced: true }, { slot: 'suffix', group: 'OfferingEffect', modId: 'Y', influenced: true }] })
const aw2 = evaluateInputs([donorMulti, donorWarlord], data, { desired: [{ slot: 'prefix', group: 'MaximumLifeIncreasePercent', label: 'Hunter +%Life' }, { slot: 'suffix', group: 'AllResistances', label: 'Warlord all-res' }], method: { kind: 'awakeners' } })
console.log(`  2-influenced Hunter donor ⇒ P(carry intended)=${(aw2.perAttemptProb * 100).toFixed(0)}% (carry is random among the donor's influenced mods)`)

// ── (3) Orb of Dominance — elevate + collateral ─────────────────────────────────
console.log('\n--- (3) Orb of Dominance — elevate + collateral ---')
const twoInf = [
  { slot: 'prefix', group: 'MaximumLifeIncreasePercent', modId: 'L', label: '+%Life', influenced: true },
  { slot: 'suffix', group: 'AllResistances', modId: 'R', label: 'all-res', influenced: true },
]
const dom = await estimateCraftCostLive({ baseName: 'Hubris Circlet', ilvl: 86, affixes: twoInf, desired: [{ slot: 'prefix', group: 'MaximumLifeIncreasePercent', label: '+%Life' }], method: { kind: 'orb-of-dominance' } }, league)
console.log(`  elevate intended (2 influenced mods): ${dom.method} · P=${(dom.perAttemptProb * 100).toFixed(0)}% ⇒ ${div(dom.totalChaos)}`)
for (const n of dom.notes) console.log(`    ${n}`)

// ── (4) eligibility (influence ⊥ eldritch via shared isInfluenced) ───────────────
console.log('\n--- (4) eligibility ---')
const already = await estimateCraftCostLive({ baseName: body.name, ilvl: 86, influence: ['shaper'], desired: [{ slot: 'prefix', group: 'MaximumLifeIncreasePercent', label: '+%Life' }], method: { kind: 'add-influence', influence: 'hunter' } }, league)
console.log(`  add-influence on an already-influenced item: supported=${already.supported} — ${already.reason}`)
const oneInf = await estimateCraftCostLive({ baseName: 'Hubris Circlet', ilvl: 86, affixes: [twoInf[0]], desired: [], method: { kind: 'orb-of-dominance' } }, league)
console.log(`  Orb of Dominance with <2 influenced mods: supported=${oneInf.supported} — ${oneInf.reason}`)

console.log('\n⚠ Awakener\'s carry semantics (one guaranteed per input, then reroll) are community-sourced — not in the data export.')
console.log('⚠ Orb of Dominance: elevate BENEFIT (Elevated-tier value) is qualitative (not cleanly in export); collateral LOSS is modelled. Annulment-class untracked orbs need manual prices.')
