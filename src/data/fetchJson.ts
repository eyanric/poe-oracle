/**
 * data layer — generic cached JSON fetcher.
 *
 * The bottom of the dependency stack (tools → services → data). Knows nothing
 * about MCP or game logic; it just fetches + caches raw JSON (repoe-fork exports,
 * the GGG passive-tree export, etc.). Services compose this; the data layer never
 * imports upward.
 *
 * `fetchImpl` is injectable so the cache/guard logic is unit-testable without network.
 */
const DEFAULT_TTL_MS = 60 * 60_000 // 1 hour — static exports only change on patches
const USER_AGENT = process.env.POE_MCP_USER_AGENT ?? 'poe-copilot (read-only; +https://github.com/eyanric/poe-copilot)'

export interface FetchJsonOptions {
  /** Cache TTL in ms (default 1h). A value ≤ 0 disables caching (always re-fetches). */
  ttlMs?: number
  /** Extra request headers. */
  headers?: Record<string, string>
  /** Injected fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/** Test/maintenance helper — clear the module cache. */
export function clearFetchJsonCache(): void {
  cache.clear()
}

/** Fetch + parse JSON with a URL-keyed TTL cache. Rejects HTML/non-JSON bodies. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
  const hit = cache.get(url)
  if (hit && Date.now() < hit.expiresAt) return hit.data as T

  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...opts.headers },
  })
  if (!res.ok) throw new Error(`fetchJson ${url}: HTTP ${res.status}`)

  const text = (await res.text()).trim()
  if (!text || text.startsWith('<')) throw new Error(`fetchJson ${url}: empty or non-JSON (HTML?) response`)

  let data: T
  try {
    data = JSON.parse(text) as T
  } catch (e) {
    throw new Error(`fetchJson ${url}: invalid JSON — ${(e as Error).message}`)
  }

  if (ttl > 0) cache.set(url, { data, expiresAt: Date.now() + ttl })
  return data
}
