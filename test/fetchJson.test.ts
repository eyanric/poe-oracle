import { describe, it, expect, beforeEach } from 'vitest'
import { fetchJson, clearFetchJsonCache } from '../src/data/fetchJson'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchJson (data layer)', () => {
  beforeEach(() => clearFetchJsonCache())

  it('parses JSON and caches within the TTL (one network call for repeated reads)', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; return jsonResponse({ ok: 1 }) }) as unknown as typeof fetch
    const a = await fetchJson<{ ok: number }>('https://x/data.json', { fetchImpl })
    const b = await fetchJson<{ ok: number }>('https://x/data.json', { fetchImpl })
    expect(a).toEqual({ ok: 1 })
    expect(b).toEqual({ ok: 1 })
    expect(calls).toBe(1) // second read served from cache
  })

  it('re-fetches when caching is disabled (ttlMs <= 0)', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; return jsonResponse({ n: calls }) }) as unknown as typeof fetch
    await fetchJson('https://x/nocache.json', { fetchImpl, ttlMs: 0 })
    await fetchJson('https://x/nocache.json', { fetchImpl, ttlMs: 0 })
    expect(calls).toBe(2)
  })

  it('rejects an HTML body (e.g. a Cloudflare challenge)', async () => {
    const fetchImpl = (async () => jsonResponse('<!DOCTYPE html><html>nope</html>')) as unknown as typeof fetch
    await expect(fetchJson('https://x/html', { fetchImpl })).rejects.toThrow(/non-JSON/i)
  })

  it('throws on a non-OK status', async () => {
    const fetchImpl = (async () => jsonResponse('err', 503)) as unknown as typeof fetch
    await expect(fetchJson('https://x/down', { fetchImpl })).rejects.toThrow(/HTTP 503/)
  })
})
