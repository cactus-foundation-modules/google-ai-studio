// How long to wait before asking Google again after a rate limit.
//
// Google's own `Retry-After` wins where it sent one - it knows when the quota
// window turns over and we do not. Without it, a ramp: the first wait is short
// because a burst limit often clears in seconds, and it lengthens because a
// per-minute quota does not, up to a minute. Beyond that there is nothing to be
// gained by waiting longer, only by waiting again.
//
// The jitter matters more than it looks. Four pictures failing together and
// retrying on the same clock would arrive together and be refused together,
// forever; spreading them means the quota lets them through one at a time.

const STEPS = [15, 25, 40, 60] as const
const MAX_JITTER_SECONDS = 5

/**
 * Seconds to wait before attempt number `attempt` (1 = the first retry).
 *
 * `jitter` is injectable purely so the tests are not at the mercy of a random
 * number; nothing else should ever pass it.
 */
export function retryDelaySeconds(
  attempt: number,
  retryAfterSeconds: number | null,
  jitter: number = Math.random(),
): number {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) return retryAfterSeconds
  const index = Math.min(Math.max(Math.trunc(attempt), 1), STEPS.length) - 1
  // The fallback is not decoration: an attempt number of NaN indexes nothing,
  // and a rate limit is no moment to start throwing.
  const step = STEPS[index] ?? STEPS[0]
  return step + Math.round(jitter * MAX_JITTER_SECONDS)
}
