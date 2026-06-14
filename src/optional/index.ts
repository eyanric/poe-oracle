/**
 * Optional tools — gated behind POB_LUA_ENABLED.
 *
 * This is the seam for the OPTIONAL tier from MIGRATION-MAP.md (the PoB
 * calc-engine bridge and anything else needing native/runtime prerequisites).
 * Nothing is registered yet; this pass ships CORE-only. The gate is wired so a
 * later slice just adds registrations here.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { log } from '../services/log'

export interface OptionalRegistration {
  enabled: boolean
  tools: string[]
}

export function registerOptionalTools(server: McpServer): OptionalRegistration {
  const flag = process.env.POB_LUA_ENABLED
  const enabled = flag === 'true' || flag === '1'

  if (!enabled) {
    log.info('[optional] POB_LUA_ENABLED off — running CORE-only (no PoB-engine tools).')
    return { enabled: false, tools: [] }
  }

  // Future slice: register PoB Lua-bridge tools on `server` here.
  void server
  log.warn('[optional] POB_LUA_ENABLED set, but no optional tools are implemented yet (stub).')
  return { enabled: true, tools: [] }
}
