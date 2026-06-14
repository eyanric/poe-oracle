/**
 * Streamable-HTTP transport at POST /mcp — for the homelab remote connector
 * (e.g. mcp-poe.havenhomelab.org/mcp).
 *
 * Stateless mode: a fresh server + transport per request (sessionIdGenerator
 * undefined). Uses Node's built-in http server so the package keeps zero web
 * framework deps. GET/DELETE on /mcp return 405 (no SSE sessions in stateless
 * mode); GET / and /health return a small liveness payload.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createPoeMcpServer } from '../server'
import { log } from '../services/log'

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}

export async function startHttp(host: string, port: number): Promise<void> {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, transport: 'streamable-http', endpoint: '/mcp' }))
      return
    }

    if (url.pathname !== '/mcp') {
      jsonRpcError(res, 404, -32601, 'Not found')
      return
    }

    if (req.method !== 'POST') {
      jsonRpcError(res, 405, -32000, 'Method not allowed (stateless transport accepts POST only)', { Allow: 'POST' })
      return
    }

    const server = createPoeMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    try {
      const body = await readBody(req)
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (err) {
      log.error('[http] request handling failed:', err)
      if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal error')
    }
  })

  await new Promise<void>(resolve => httpServer.listen(port, host, resolve))
  log.info(`[poe-mcp] listening on streamable-http at http://${host}:${port}/mcp`)
}
