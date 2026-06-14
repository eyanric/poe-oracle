/**
 * Smoke test — rare-pricing service against real listings (LIVE).
 *
 *   npx tsx scripts/smoke-rare-pricing.mjs
 *
 * Prices 4 real rares spanning easy→hard and prints the confidence-flagged RANGE,
 * the pseudo stats queried, market depth, and any mods NOT captured by pseudo-pricing.
 * This is a smoke test (does the live path work + look sane), not an accuracy claim —
 * rares aren't fungible. Honour rate limits: it runs a small, sequential set.
 */
import { estimateRarePriceLive } from '../src/services/rarePricing.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

const league = await resolveCurrentLeague()
console.log(`=== rare-pricing smoke — league ${league} ===\n`)

const cases = [
  {
    name: 'A) clean life/res ring (easy)',
    spec: { baseType: 'Vermillion Ring', itemClass: 'Ring', itemLevel: 84,
      mods: ['+85 to maximum Life', '+40% to Fire Resistance', '+38% to Cold Resistance'] },
  },
  {
    name: 'B) life + triple-res boots (easy/medium)',
    spec: { baseType: 'Two-Toned Boots', itemClass: 'Boots', itemLevel: 85,
      mods: ['+80 to maximum Life', '+30% to all Elemental Resistances', '25% increased Movement Speed'] },
  },
  {
    name: 'C) Shaper body armour, life + res (medium/hard)',
    spec: { baseType: 'Vaal Regalia', itemClass: 'Body Armour', itemLevel: 86, influences: ['Shaper'],
      mods: ['+120 to maximum Life', '+45% to Fire Resistance', '+40% to Lightning Resistance'] },
  },
  {
    name: 'D) phys/crit dagger (hard — pseudo-pricing covers little, expect a flagged miss)',
    spec: { baseType: 'Imperial Skean', itemClass: 'Dagger', itemLevel: 84,
      mods: ['Adds 25 to 60 Physical Damage', '120% increased Critical Strike Chance', '18% increased Attack Speed'] },
  },
]

const fmt = (c, div) => (c == null ? '—' : `${c.toFixed(0)}c${div ? ` (${(c / div).toFixed(2)} div)` : ''}`)

for (const { name, spec } of cases) {
  console.log(`--- ${name} ---`)
  try {
    const r = await estimateRarePriceLive(spec, league)
    const div = r.range && r.divine ? r.range.median / r.divine.median : null
    console.log(`  queried: ${r.queriedStats.map(s => `${s.label.replace('+# ', '').replace('+#% ', '')}≥${s.min}`).join(', ') || '(base/identity only)'}`)
    if (r.priced) {
      console.log(`  RANGE: ${fmt(r.range.low, div)} – ${fmt(r.range.median, div)}  · cheapest(bait?) ${r.range.cheapest.toFixed(0)}c · depth ${r.marketDepth} · ${r.confidence} confidence`)
    } else {
      console.log(`  NOT PRICED: ${r.reason}`)
    }
    if (r.unpricedMods.length) console.log(`  ⚠ not captured by pseudo-pricing: ${r.unpricedMods.join('; ')}`)
    if (r.tradeUrl) console.log(`  ${r.tradeUrl}`)
  } catch (e) {
    console.log(`  ERROR: ${e?.message ?? e}`)
  }
  console.log('')
}
console.log('NOTE: smoke test — proves the live path + sane shape, not pricing accuracy.')
