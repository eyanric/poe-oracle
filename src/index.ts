#!/usr/bin/env node
/** Entry point — selects the transport from env and starts the server. */
import { loadConfig } from './config'
import { startStdio } from './transports/stdio'
import { startHttp } from './transports/http'
import { log } from './services/log'

async function main(): Promise<void> {
  const cfg = loadConfig()
  if (cfg.transport === 'http') {
    await startHttp(cfg.httpHost, cfg.httpPort)
  } else {
    await startStdio()
  }
}

main().catch(err => {
  log.error('[poe-mcp] fatal:', err)
  process.exit(1)
})
