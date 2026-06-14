/** stdio transport — for Claude Desktop / Claude Code spawned locally. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createPoeMcpServer } from '../server'
import { log } from '../services/log'

export async function startStdio(): Promise<void> {
  const server = createPoeMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log.info('[poe-mcp] listening on stdio transport')
}
