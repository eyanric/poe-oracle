/**
 * rateLimit — stateless rate-limiting primitives.
 *
 * Lifted from VAAL's HumanInput, but ONLY the detection-neutral pieces: a token
 * bucket, sleep, and exponential backoff. None of the ban-resistance behaviour
 * (bezier paths, jittered cadence, fatigue) is carried over — these are plain
 * client-side throttles for being polite to public APIs.
 */

/** Sleep for ms milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, Math.max(0, ms)))
}

/**
 * TokenBucket — limits how many operations can happen per time window.
 * Used to stay under public API rate limits.
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly capacity: number,
    private readonly refillRatePerSecond: number
  ) {
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerSecond)
    this.lastRefill = now
  }

  /** Consume one token, waiting until one is available. */
  async consume(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }
    const waitMs = ((1 - this.tokens) / this.refillRatePerSecond) * 1000
    await sleep(waitMs)
    this.tokens = 0
  }

  hasToken(): boolean {
    this.refill()
    return this.tokens >= 1
  }

  get available(): number {
    this.refill()
    return this.tokens
  }
}

/** Retry an operation with capped exponential backoff + jitter. */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number
    baseDelayMs?: number
    maxDelayMs?: number
    onRetry?: (attempt: number, error: Error) => void
  } = {}
): Promise<T> {
  const { maxAttempts = 5, baseDelayMs = 1000, maxDelayMs = 30000, onRetry } = opts
  let lastError: Error = new Error('Unknown')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err as Error
      if (attempt === maxAttempts) break
      const expDelay = baseDelayMs * Math.pow(2, attempt - 1)
      const jitter = Math.random() * 1000
      const delay = Math.min(maxDelayMs, expDelay + jitter)
      onRetry?.(attempt, lastError)
      await sleep(delay)
    }
  }
  throw lastError
}
