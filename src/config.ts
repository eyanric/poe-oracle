/** Runtime configuration from environment. */

export type TransportKind = 'stdio' | 'http'

export interface AppConfig {
  /** Selected by MCP_TRANSPORT (alias TRANSPORT): "stdio" (default) | "http". */
  transport: TransportKind
  httpHost: string
  httpPort: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = (env.MCP_TRANSPORT ?? env.TRANSPORT ?? 'stdio').toLowerCase()
  const transport: TransportKind =
    raw === 'http' || raw === 'streamable-http' || raw === 'streamable' ? 'http' : 'stdio'

  return {
    transport,
    httpHost: env.MCP_HTTP_HOST ?? '0.0.0.0',
    httpPort: parseInt(env.PORT ?? env.MCP_HTTP_PORT ?? '3000', 10),
  }
}
