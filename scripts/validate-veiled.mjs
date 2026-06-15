/**
 * Veiled crafting — validation (Tier-2). Run with tsx.
 *
 *   npm run validate:veiled
 *
 * Shows, live: (1) unveil P(desired) WITH vs WITHOUT pre-blocking; (2) Veiled Chaos (cheap,
 * destructive reroll) vs Veiled Exalt (expensive, clean add) — same pool ⇒ identical P, only
 * cost + item-state differ; (3) veiled modelled as a NORMAL-slot mod. Analysis-only; read-only.
 */
import { getMods, getBaseItems } from '../src/data/repoe.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { buildVeiledPool, unveilShare, pUnveil } from '../src/services/veiled.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'

const league = await resolveCurrentLeague()
const [mods, bases] = await Promise.all([getMods(), getBaseItems()])
const snap = await getEconomyProvider().getEconomySnapshot(league)
const divine = searchEconomy(snap, 'Divine Orb', 'currency', 1)[0]?.chaosValue ?? null
const div = (c) => (c == null ? '—' : `${c.toFixed(0)}c${divine ? ` (${(c / divine).toFixed(2)} div)` : ''}`)

const gloves = Object.values(bases).find(b => b.name === 'Fingerless Silk Gloves' && b.release_state === 'released')
  || Object.values(bases).find(b => b.tags?.includes('gloves') && b.release_state === 'released')
console.log(`=== Veiled validation — ${gloves.name} (ilvl 84) · League: ${league} ===\n`)

const affix = 'prefix'
const full = buildVeiledPool(new Set(gloves.tags), affix, 84, mods)
const byWeight = [...full.entries].sort((a, b) => b.weight - a.weight)
console.log(`veiled ${affix} pool: ${full.entries.length} mods · Σ${full.total}`)
console.log('  top groups: ' + byWeight.slice(0, 5).map(e => `${e.group}(w${e.weight})`).join(', '))

// desired = a mid-pack veiled mod; block the two heaviest OTHER groups
const desired = byWeight[Math.floor(byWeight.length / 2)]
const blockGroups = byWeight.filter(e => e.group !== desired.group).slice(0, 3).map(e => e.group)
console.log(`\ndesired: ${desired.group} (w${desired.weight}) — "${(desired.text || '').replace(/\n/g, ' / ')}"`)

// ── (1) P(desired) with vs without blocking ─────────────────────────────────────
console.log('\n--- (1) unveil P(desired) — blocking lever ---')
const shareNo = unveilShare(full, { group: desired.group })
const blocked = buildVeiledPool(new Set(gloves.tags), affix, 84, mods, new Set(blockGroups))
const shareYes = unveilShare(blocked, { group: desired.group })
console.log(`  WITHOUT blocking: share ${(shareNo * 100).toFixed(1)}% ⇒ P(in 3) ${(pUnveil(shareNo) * 100).toFixed(1)}%`)
console.log(`  WITH blocking ${blockGroups.length} heavy veils: share ${(shareYes * 100).toFixed(1)}% ⇒ P(in 3) ${(pUnveil(shareYes) * 100).toFixed(1)}% ↑`)

// ── (2) Veiled Chaos vs Veiled Exalt — same pool, cost + destructiveness ─────────
console.log('\n--- (2) Veiled Chaos (destructive reroll) vs Veiled Exalt (clean add) ---')
const desiredSpec = [{ slot: affix, group: desired.group, label: desired.group }]
// Veiled Chaos: used on a built item (has existing mods) → destructiveness flagged
const chaos = await estimateCraftCostLive({ baseName: gloves.name, ilvl: 84, blockedGroups: blockGroups, affixes: [{ slot: 'suffix', group: 'X', modId: 'X' }, { slot: 'suffix', group: 'Y', modId: 'Y' }], desired: desiredSpec, method: { kind: 'veiled-chaos' } }, league)
// Veiled Exalt: clean add to an open prefix slot (fresh-ish item)
const exalt = await estimateCraftCostLive({ baseName: gloves.name, ilvl: 84, blockedGroups: blockGroups, desired: desiredSpec, method: { kind: 'veiled-exalt' } }, league)
console.log(`  Veiled Chaos: P ${(chaos.perAttemptProb * 100).toFixed(1)}% · ~${chaos.expectedAttempts.toFixed(1)} orbs ⇒ ${div(chaos.totalChaos)}`)
console.log(`  Veiled Exalt: P ${(exalt.perAttemptProb * 100).toFixed(1)}% · ~${exalt.expectedAttempts.toFixed(1)} orbs ⇒ ${div(exalt.totalChaos)}`)
console.log(`  SAME-POOL CHECK: P identical = ${Math.abs(chaos.perAttemptProb - exalt.perAttemptProb) < 1e-9} (only cost + destructiveness differ)`)
console.log(`  price gap: Veiled Exalt / Veiled Chaos = ${(exalt.consumables[0].chaosEach / chaos.consumables[0].chaosEach).toFixed(0)}×`)
console.log('\n  Veiled Chaos notes:'); for (const n of chaos.notes) console.log(`    ${n}`)
console.log('  Veiled Exalt notes:'); for (const n of exalt.notes) console.log(`    ${n}`)

// ── (3) Veiled Exalt with no open slot → unsupported (clean-add needs a slot) ────
const fullItem = await estimateCraftCostLive({ baseName: gloves.name, ilvl: 84, affixes: [{ slot: 'prefix', group: 'A', modId: 'A' }, { slot: 'prefix', group: 'B', modId: 'B' }, { slot: 'prefix', group: 'C', modId: 'C' }], desired: desiredSpec, method: { kind: 'veiled-exalt' } }, league)
console.log(`\n--- (3) Veiled Exalt with no open ${affix} slot: supported=${fullItem.supported} — ${fullItem.reason}`)

console.log('\n⚠ Aisling/safehouse slam REMOVED (Syndicate rework) — not modelled. Veiled = normal-slot mod.')
console.log('⚠ P(in 3) uses the 1-(1-share)^3 approximation; member-specific unveil sub-pools are a flagged refinement.')
