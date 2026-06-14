/**
 * GggRateLimiter — honours GGG's dynamic Trade API rate-limit headers.
 *
 * GGG returns, per response:
 *   X-Rate-Limit-Rules: Ip[,Account,…]
 *   X-Rate-Limit-Ip:        "5:15:60,10:90:300,30:300:1800"   (max:window:penalty …)
 *   X-Rate-Limit-Ip-State:  "1:15:0,1:90:0,1:300:0"           (current:window:penaltyActive …)
 * and on a 429: Retry-After: <seconds>.
 *
 * We never retry-storm: after every response we compute a `blockedUntil` and the
 * caller `acquire()`s (awaits) before the next request. If any bucket is at its
 * limit we wait out its window; a 429 / active penalty blocks for that duration.
 */
import { sleep } from './rateLimit'

type HeaderGet = (name: string) => string | null | undefined

function parseTriples(raw: string | null | undefined): Array<[number, number, number]> {
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const [a, b, c] = s.split(':').map(n => parseInt(n, 10))
      return [a || 0, b || 0, c || 0] as [number, number, number]
    })
}

export class GggRateLimiter {
  private blockedUntil = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Update internal backoff state from a response's status + headers. */
  noteResponse(status: number, get: HeaderGet): void {
    const t = this.now()
    const rules = (get('x-rate-limit-rules') ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)

    for (const rule of rules) {
      const limits = parseTriples(get(`x-rate-limit-${rule}`))
      const states = parseTriples(get(`x-rate-limit-${rule}-state`))
      for (let i = 0; i < limits.length; i++) {
        const [max, window] = limits[i]
        const state = states[i]
        const current = state?.[0] ?? 0
        const penaltyActive = state?.[2] ?? 0
        if (penaltyActive > 0) this.block(t + penaltyActive * 1000)
        // At the limit → wait out the window so the next request can't 429.
        if (max > 0 && current >= max) this.block(t + window * 1000)
      }
    }

    if (status === 429) {
      const retryAfter = parseInt(get('retry-after') ?? '', 10)
      const penalties = rules
        .flatMap(r => parseTriples(get(`x-rate-limit-${r}-state`)).map(s => s[2]))
        .filter(n => n > 0)
      const waitSec = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : penalties.length
          ? Math.max(...penalties)
          : 60
      this.block(t + waitSec * 1000)
    }
  }

  /** Milliseconds the caller must wait before the next request (0 if clear). */
  nextDelayMs(): number {
    return Math.max(0, this.blockedUntil - this.now())
  }

  /** Block until clear, then proceed. */
  async acquire(): Promise<void> {
    const delay = this.nextDelayMs()
    if (delay > 0) await sleep(delay)
  }

  private block(until: number): void {
    if (until > this.blockedUntil) this.blockedUntil = until
  }
}
