import { describe, expect, it } from 'vitest'
import { retryDelaySeconds } from './backoff'
import { parseRetryAfter } from './gemini'

describe('retryDelaySeconds', () => {
  it('honours what Google asked for, whatever the attempt', () => {
    expect(retryDelaySeconds(1, 90, 0)).toBe(90)
    expect(retryDelaySeconds(7, 3, 0)).toBe(3)
  })

  it('ramps up and then stops ramping', () => {
    expect(retryDelaySeconds(1, null, 0)).toBe(15)
    expect(retryDelaySeconds(2, null, 0)).toBe(25)
    expect(retryDelaySeconds(3, null, 0)).toBe(40)
    expect(retryDelaySeconds(4, null, 0)).toBe(60)
    expect(retryDelaySeconds(99, null, 0)).toBe(60)
  })

  it('spreads simultaneous retries apart, so they are not refused together', () => {
    expect(retryDelaySeconds(1, null, 1)).toBe(20)
    expect(retryDelaySeconds(1, null, 0.5)).toBeGreaterThan(retryDelaySeconds(1, null, 0))
  })

  it('treats a nonsense attempt number as the first', () => {
    expect(retryDelaySeconds(0, null, 0)).toBe(15)
    expect(retryDelaySeconds(-3, null, 0)).toBe(15)
    expect(retryDelaySeconds(NaN, null, 0)).toBe(15)
    expect(retryDelaySeconds(2.7, null, 0)).toBe(25)
  })

  it('ignores a Retry-After that says nothing useful', () => {
    expect(retryDelaySeconds(1, 0, 0)).toBe(15)
    expect(retryDelaySeconds(1, -5, 0)).toBe(15)
  })
})

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-09-10T12:00:00Z')

  it('reads a plain number of seconds', () => {
    expect(parseRetryAfter('30', now)).toBe(30)
  })

  it('reads an HTTP date as a delay from now', () => {
    expect(parseRetryAfter('Thu, 10 Sep 2026 12:00:45 GMT', now)).toBe(45)
  })

  it('ignores what it cannot use', () => {
    expect(parseRetryAfter(null, now)).toBeNull()
    expect(parseRetryAfter('', now)).toBeNull()
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter('0', now)).toBeNull()
    // A date already past says nothing about how long to wait.
    expect(parseRetryAfter('Thu, 10 Sep 2026 11:59:00 GMT', now)).toBeNull()
  })

  it('refuses a value that would park the browser for the afternoon', () => {
    expect(parseRetryAfter('3600', now)).toBe(3600)
    expect(parseRetryAfter('3601', now)).toBeNull()
  })
})
