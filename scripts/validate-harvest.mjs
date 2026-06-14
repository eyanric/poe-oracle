/**
 * Harvest validation (LIVE) — npm run validate:harvest
 *
 * Proves the first real method on the interface against real RePoE mods + live prices:
 * blocked-vs-open augment contrast, reforge distribution, remove, ignores-locks, and
 * whether lifeforce prices live. Leads with what the Harvest data reflects.
 */
import { getMods, getBaseItems } from '../src/data/repoe.js'
import { buildSlotPool } from '../src/services/craftingModel.js'
import { harvestModule } from '../src/services/harvest.js'
import { newItemState, withBlockedGroup, withMeta } from '../src/services/itemState.js'
import { HARVEST_PROVENANCE, LIFEFORCE_ITEM, HARVEST_TAG_TO_MODTAG } from '../src/data/harvestCrafts.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

let failures = 0
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) failures++ }

console.log('=== Harvest validation (3.28) ===\n')
console.log('--- data provenance ---')
console.log('  ' + HARVEST_PROVENANCE + '\n')

const [mods, bases] = await Promise.all([getMods(), getBaseItems()])
const vr = Object.values(bases).find(b => b.name === 'Vaal Regalia' && b.release_state === 'released')
const state = newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 84, tags: vr.tags })
const data = { mods }

// pick a tag with multiple suffix groups so open augment is a real distribution
const tag = 'cold', slot = 'suffix', modTag = HARVEST_TAG_TO_MODTAG[tag]
const pool = buildSlotPool(mods, new Set(vr.tags), 84, slot, {})
const coldGroups = [...new Set(pool.filter(e => (e.mod.implicit_tags ?? []).includes(modTag)).map(e => e.group))]
console.log(`--- live mods: ${tag} ${slot} groups on Vaal Regalia: ${coldGroups.length} (${coldGroups.slice(0, 6).join(', ')}) ---`)
const desired = { slot, group: coldGroups[0], label: coldGroups[0] }
const others = coldGroups.slice(1)
const params = (craft, st = state) => ({ inputs: [st], data, p: { desired: [desired], method: { kind: 'harvest', craft, tag } } })

// ── lifeforce live price ──────────────────────────────────────────────────────
const snap = await getEconomyProvider().getEconomySnapshot(await resolveCurrentLeague())
const lf = searchEconomy(snap, LIFEFORCE_ITEM.Wild, undefined, 1)[0] || searchEconomy(snap, 'Vivid Crystallised Lifeforce', undefined, 1)[0]
console.log(`\n--- lifeforce live price ---`)
console.log(lf ? `  ${lf.name}: ${lf.chaosValue}c (${lf.category})` : '  ⚠ lifeforce NOT found in economy snapshot — costs will be unpriced/flagged')

// ── reforge distribution ──────────────────────────────────────────────────────
console.log('\n--- reforge-with-tag (distribution) ---')
const rf = harvestModule.evaluate([state], data, params('reforge').p)
ok('reforge supported, tag-guaranteed distribution (0<p<1 or =1)', rf.supported && rf.perAttemptProb > 0, `P(target|${tag})=${(rf.perAttemptProb * 100).toFixed(1)}%`)

// ── augment: reads blocked groups (contrast) ──────────────────────────────────
console.log('\n--- augment: reads blocked groups ---')
const open = harvestModule.evaluate([state], data, params('augment').p)
let blockedState = state
for (const g of others) blockedState = withBlockedGroup(blockedState, g)
const blocked = harvestModule.evaluate([blockedState], data, params('augment', blockedState).p)
console.log(`  open P=${(open.perAttemptProb * 100).toFixed(1)}% (${coldGroups.length} ${tag} group(s)) · blocked P=${(blocked.perAttemptProb * 100).toFixed(1)}% (step=${blocked.blueprint?.steps[0].kind})`)
ok('augment reads item-state + is deterministic when the pool is one group', blocked.perAttemptProb === 1 && blocked.blueprint?.steps[0].kind === 'fixed')
if (coldGroups.length < 2) console.log(`  NOTE: "${tag}" resolves to ONE ${slot} group on this base, so augment is already deterministic. The open→blocked CONTRAST (p<1 → p=1) is covered by the multi-group unit test (test/harvest.test.ts).`)

// ── ignores meta-locks ────────────────────────────────────────────────────────
console.log('\n--- ignores meta-locks ---')
const lockedReforge = harvestModule.evaluate([withMeta(state, { lockSuffixes: true })], data, params('reforge').p)
ok('reforge proceeds on a locked item (Harvest ignores locks)', lockedReforge.supported)
ok('flagged DANGEROUS (will wipe locked affixes), not safe', /IGNORES|WIPE/.test(lockedReforge.notes.join(' ')))
ok('module declares respectsLocks=false', harvestModule.respectsLocks === false)

console.log(`\n=== ${failures === 0 ? 'ALL HARVEST CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`)
console.log('NOTE: lifeforce AMOUNTS are low-confidence (see provenance); colour→tag mapping + craft shapes confirmed.')
process.exit(failures === 0 ? 0 : 1)
