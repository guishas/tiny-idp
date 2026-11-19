import { HttpError } from '@/http/http-error'
import type { Session } from '@/store'

// Policy: approving an invoice of R$ 1.000,00 or more needs a recent second factor. The amount is
// known only to the resource, which is exactly the case RFC 9470 was written for.
export const STEP_UP_AMOUNT = 100_000
const STEP_UP_MAX_AGE_SECONDS = 300

export const requiresStepUp = (amount: number) => amount >= STEP_UP_AMOUNT

// Both conditions must hold: the session reached 'mfa' (stronger) AND it happened recently
// (max_age). A strong login from yesterday is not enough for a sensitive action today.
export function hasFreshMfa(session: Session, now = Date.now()) {
  return session.acr === 'mfa' && now - session.authTime <= STEP_UP_MAX_AGE_SECONDS * 1000
}

// The RFC 9470 challenge: it tells the client exactly what to obtain before retrying. It is
// enforced here, on the server, so calling the API directly cannot skip it.
export function stepUpChallenge() {
  return new HttpError(
    401,
    'insufficient_user_authentication',
    {
      'www-authenticate': `Bearer error="insufficient_user_authentication", acr_values="mfa", max_age="${STEP_UP_MAX_AGE_SECONDS}"`,
    },
    { acr_values: 'mfa', max_age: STEP_UP_MAX_AGE_SECONDS },
  )
}
