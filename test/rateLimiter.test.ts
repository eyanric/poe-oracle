import { describe, it, expect } from 'vitest'
import { GggRateLimiter } from '../src/services/RateLimiter'

const getter = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()] ?? null

describe('GggRateLimiter', () => {
  it('backs off on a 429 honoring Retry-After', () => {
    let now = 0
    const lim = new GggRateLimiter(() => now)
    lim.noteResponse(429, getter({ 'retry-after': '30' }))
    expect(lim.nextDelayMs()).toBe(30_000)
    now = 31_000
    expect(lim.nextDelayMs()).toBe(0)
  })

  it('waits out the window when a bucket is at its limit (proactive, no 429 needed)', () => {
    const lim = new GggRateLimiter(() => 0)
    lim.noteResponse(200, getter({
      'x-rate-limit-rules': 'Ip',
      'x-rate-limit-ip': '5:15:60,10:90:300',
      'x-rate-limit-ip-state': '5:15:0,6:90:0', // first bucket at limit (5/5)
    }))
    expect(lim.nextDelayMs()).toBe(15_000)
  })

  it('stays clear while under every limit', () => {
    const lim = new GggRateLimiter(() => 0)
    lim.noteResponse(200, getter({
      'x-rate-limit-rules': 'Ip',
      'x-rate-limit-ip': '5:15:60',
      'x-rate-limit-ip-state': '1:15:0',
    }))
    expect(lim.nextDelayMs()).toBe(0)
  })

  it('429 without Retry-After falls back to the active penalty from the state header', () => {
    const lim = new GggRateLimiter(() => 0)
    lim.noteResponse(429, getter({
      'x-rate-limit-rules': 'Ip',
      'x-rate-limit-ip': '5:15:60',
      'x-rate-limit-ip-state': '6:15:60', // 60s penalty active
    }))
    expect(lim.nextDelayMs()).toBe(60_000)
  })

  it('acquire() resolves immediately when clear', async () => {
    const lim = new GggRateLimiter(() => 0)
    await expect(lim.acquire()).resolves.toBeUndefined()
  })
})
