import { HttpError } from '@/http/http-error'
import { verifyTotp } from '@/lib/totp'
import type { TotpFactor } from '@/store'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 60_000

// Checks a code against the factor and applies the attempt limit. A 6-digit code has only a million
// values, so without a limit it could be guessed within its 30-second life. While locked, even
// the correct code is refused: that is what stops the guessing.
//
// Returns the accepted step, or null. It does NOT mark the step as used: only /stepup does that,
// so confirming at enrollment does not burn the code needed for the first step-up.
export function checkTotpCode(factor: TotpFactor, code: string, now = Date.now()) {
  if (factor.lockedUntil > now) {
    const retryAfter = Math.ceil((factor.lockedUntil - now) / 1000)
    throw new HttpError(429, 'too_many_attempts', { 'retry-after': String(retryAfter) })
  }

  const counter = verifyTotp(factor.secret, code, now, factor.lastUsedCounter)

  if (counter === null) {
    factor.failedAttempts += 1

    if (factor.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      factor.failedAttempts = 0
      factor.lockedUntil = now + LOCKOUT_MS
    }

    return null
  }

  factor.failedAttempts = 0
  return counter
}
