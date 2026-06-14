// Live appraise + watch acceptance. Spawns the stdio server.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node', args: ['dist/index.js'],
  env: { ...process.env, POE_MCP_LOG: 'info' }, // info → see [trade] pacing logs on stderr
})
const client = new Client({ name: 'appraise-acceptance', version: '0.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log('TOOLS:', tools.map(t => t.name).join(', '))

async function appraise(query, extra = {}) {
  const r = await client.callTool({ name: 'appraise', arguments: { query, ...extra } })
  const a = r.structuredContent
  console.log(`\n### appraise("${query}")  ${a.category}`)
  for (const agg of a.aggregators) console.log(`  agg ${agg.source}: ${agg.chaosValue.toFixed(1)}c · ${agg.listingCount} listings`)
  console.log(`  divergence: ${a.divergence.pct == null ? 'n/a' : a.divergence.pct.toFixed(1) + '%'} · divergent=${a.divergence.divergent}`)
  if (a.live) console.log(`  live[${a.live.kind}]: low=${a.live.low.toFixed(1)}c median=${a.live.median.toFixed(1)}c count=${a.live.count} sample=${a.live.sampleSize} freshest=${a.live.snapshotAgeSec}s`)
  console.log(`  liquidity: ${a.liquidity.rating} (tier=${a.liquidity.tier}, depth=${a.liquidity.depth})`)
  const m = a.margin
  console.log(`  listingSpread(raw): ${m.listingSpread ? `${m.listingSpread.low.toFixed(1)}→${m.listingSpread.median.toFixed(1)}c = ${m.listingSpread.spreadPct.toFixed(0)}%` : 'n/a'}`)
  console.log(`  actionableMargin: ${m.actionable ? `buy ${m.actionable.buy.toFixed(1)}c → sell ${m.actionable.sellRef.toFixed(1)}c = ${m.actionable.marginPct.toFixed(0)}% (fresh ${m.actionable.freshDepth})` : `null — ${m.reason}`} · confidence=${m.confidence.label}`)
}

for (const q of ['Headhunter', 'Divine Orb', 'Mageblood']) {
  try { await appraise(q) } catch (e) { console.log(`appraise("${q}") error:`, e.message) }
}
// Headhunter with a wide freshness window to show the actionable margin when fresh listings exist
await appraise('Headhunter', { freshnessWindowSec: 86400 })

console.log('\n=== watch ~5 items (sorted by actionableMargin) ===')
const w = await client.callTool({ name: 'watch', arguments: { items: ['Divine Orb', 'Exalted Orb', 'Chaos Orb', 'Headhunter', 'Mageblood'], freshnessWindowSec: 86400 } })
console.log(w.content[0].text)

await client.close()
