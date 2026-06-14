// Smoke test for the streamable-http transport: spawn the server in http mode,
// connect an MCP client to POST /mcp, list tools, hit /health, then shut down.
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const PORT = 3210
const child = spawn('node', ['dist/index.js'], {
  env: { ...process.env, MCP_TRANSPORT: 'http', PORT: String(PORT), MCP_HTTP_HOST: '127.0.0.1', POE_MCP_LOG: 'silent' },
  stdio: 'inherit',
})

try {
  await wait(800)
  const health = await fetch(`http://127.0.0.1:${PORT}/health`).then(r => r.json())
  console.log('HEALTH:', JSON.stringify(health))

  const client = new Client({ name: 'http-acceptance', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)))
  const { tools } = await client.listTools()
  console.log('HTTP TOOLS:', tools.map(t => t.name).join(', '))
  await client.close()
} finally {
  child.kill()
}
