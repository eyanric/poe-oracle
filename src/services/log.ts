/**
 * log — minimal stderr logger.
 *
 * Replaces VAAL's `electron-log` so the ported services run as plain Node with
 * no Electron runtime. Everything goes to **stderr**: on the stdio transport,
 * stdout is reserved for the MCP JSON-RPC stream and must never carry log text.
 * Set `POE_MCP_LOG=silent` to suppress.
 */
const SILENT = process.env.POE_MCP_LOG === 'silent'

function emit(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  if (SILENT) return
  const ts = new Date().toISOString()
  console.error(`[${ts}] [${level}]`, ...args)
}

export const log = {
  info:  (...args: unknown[]) => emit('info', args),
  warn:  (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
}
