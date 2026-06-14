// End-to-end acceptance (live). Exercises both economy providers + low-confidence handling.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function withServer(provider, fn) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { ...process.env, ECONOMY_PROVIDER: provider, POE_MCP_LOG: 'silent' },
  })
  const client = new Client({ name: 'acceptance', version: '0.0.0' })
  await client.connect(transport)
  try { return await fn(client) } finally { await client.close() }
}

async function priceCheck(client, query) {
  const r = await client.callTool({ name: 'price_check', arguments: { query } })
  return r.structuredContent
}

console.log('=== price_check("Divine Orb") — side by side ===')
for (const provider of ['poewatch', 'poeninja', 'both']) {
  const sc = await withServer(provider, c => priceCheck(c, 'Divine Orb'))
  console.log(`\n[${provider}] league=${sc.league}`)
  for (const m of (sc.matches || []).filter(m => m.name === 'Divine Orb')) {
    console.log(`  Divine Orb: ${m.chaosValue}c · ${m.divineValue?.toFixed?.(2)} div · ${m.listingCount} listings · source=${m.source} · lowConf=${m.lowConfidence}`)
  }
}

console.log('\n=== currency_overview (poewatch default) top 5 — no low-confidence outlier ===')
await withServer('poewatch', async c => {
  const tools = await c.listTools()
  console.log('TOOLS:', tools.tools.map(t => t.name).join(', '))
  const r = await c.callTool({ name: 'currency_overview', arguments: {} })
  const sc = r.structuredContent
  console.log(`league=${sc.league} · count=${sc.count} · excludedLowConfidence=${sc.excludedLowConfidence}`)
  for (const c2 of sc.currencies.slice(0, 5)) {
    console.log(`  ${c2.name}: ${c2.chaosValue.toFixed(1)}c · ${c2.listingCount} listings · lowConf=${c2.lowConfidence}`)
  }
  const anyLowOnTop = sc.currencies.slice(0, 5).some(x => x.lowConfidence)
  console.log('TOP-5 contains low-confidence?', anyLowOnTop)
})
