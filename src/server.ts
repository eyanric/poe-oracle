/**
 * Builds the consolidated PoE MCP server: an always-on CORE (data/economy/
 * analysis, zero native deps) plus an OPTIONAL tier gated by POB_LUA_ENABLED.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerEconomyTools } from './tools/economy'
import { registerAppraiseTool, registerPriceCheckItemTool, registerWatchTool } from './tools/appraise'
import { registerCraftCostTool } from './tools/craft'
import { registerLeagueStartTools } from './tools/leagueStart'
import { registerPobTools } from './tools/pob'
import { registerOptionalTools } from './optional/index'

export const SERVER_NAME = 'poe-oracle'
export const SERVER_VERSION = '0.1.0'

/** Create a fully-wired server instance (used by every transport). */
export function createPoeMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  // CORE — always on.
  registerEconomyTools(server)
  registerAppraiseTool(server)
  registerPriceCheckItemTool(server)
  registerWatchTool(server)
  registerCraftCostTool(server)
  registerLeagueStartTools(server)
  registerPobTools(server)

  // OPTIONAL — gated (currently a stub; registers nothing).
  registerOptionalTools(server)

  return server
}
