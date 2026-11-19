import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { checkTotpCode } from '@/auth/mfa'
import { elevateSession, setSessionCookie } from '@/auth/sessions'
import { HttpError } from '@/http/http-error'
import { requireUser } from '@/http/require-user'
import { parseBody } from '@/http/validate'
import { base32Encode } from '@/lib/base32'
import { generateTotpSecret } from '@/lib/totp'

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) })

const ISSUER_LABEL = 'tiny-idp'

export async function mfaRoutes(app: FastifyInstance) {
  // The only moment the secret is ever returned. After this it is used to verify and nothing more.
  app.post('/mfa/totp/enroll', async (request, reply) => {
    const { user } = requireUser(request)

    // Replacing an active factor from a mere session would let a stolen password-only session
    // swap in the attacker's authenticator. Changing MFA is a separate, protected flow.
    if (user.totp?.confirmed) throw new HttpError(409, 'mfa_already_enabled')

    const secret = generateTotpSecret()
    user.totp = {
      secret,
      confirmed: false,
      lastUsedCounter: -1,
      failedAttempts: 0,
      lockedUntil: 0,
    }

    const encoded = base32Encode(secret)
    // The colon between issuer and account stays literal, as authenticator apps expect.
    const label = `${ISSUER_LABEL}:${encodeURIComponent(user.email)}`

    // no-store: this response carries a secret and must not sit in any cache.
    reply.header('cache-control', 'no-store')

    return {
      secret: encoded,
      otpauth_uri: `otpauth://totp/${label}?secret=${encoded}&issuer=${ISSUER_LABEL}`,
    }
  })

  // Enrollment is only complete once the user proves the app really holds the secret. Without
  // this, a typo while scanning would lock the user out the first time MFA is required.
  app.post('/mfa/totp/confirm', async (request, reply) => {
    const { user } = requireUser(request)
    const { code } = parseBody(codeSchema, request.body)

    const factor = user.totp
    if (!factor) throw new HttpError(409, 'mfa_not_enrolled')
    if (factor.confirmed) throw new HttpError(409, 'mfa_already_enabled')

    if (checkTotpCode(factor, code) === null) throw new HttpError(400, 'invalid_code')

    factor.confirmed = true

    return reply.code(204).send()
  })

  app.post('/stepup', async (request, reply) => {
    const { user, session } = requireUser(request)
    const { code } = parseBody(codeSchema, request.body)

    const factor = user.totp
    if (!factor?.confirmed) throw new HttpError(409, 'mfa_not_enabled')

    const counter = checkTotpCode(factor, code)
    if (counter === null) throw new HttpError(401, 'invalid_code')

    // Anti-replay. Checking and recording happen in the same synchronous run, with no await in
    // between, so two parallel requests with the same code cannot both pass.
    factor.lastUsedCounter = counter

    setSessionCookie(reply, elevateSession(session))

    return reply.code(204).send()
  })
}
