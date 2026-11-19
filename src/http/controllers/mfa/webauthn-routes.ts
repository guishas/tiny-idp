import type { FastifyInstance } from 'fastify'

import { env } from '@/env'
import { requireUser } from '@/http/require-user'
import { randomToken } from '@/lib/random'
import { passkeyChallenges } from '@/store'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

// Optional bonus, only the first step of passkey registration. A real registration would verify
// the authenticator's response (origin, RP ID, signature) with a library; here the server just
// issues the options and remembers the challenge.
export async function webauthnRoutes(app: FastifyInstance) {
  app.post('/webauthn/register/options', async (request, reply) => {
    const { user } = requireUser(request)

    // A new, unguessable challenge every time: a captured response can never be replayed against
    // a later registration. One pending challenge per user, so a new call replaces the old one.
    const challenge = randomToken()
    passkeyChallenges.set(user.id, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS })

    reply.header('cache-control', 'no-store')

    return {
      challenge,
      // The RP ID is the domain the credential is bound to, with no scheme or port.
      rp: { id: new URL(env.ISSUER).hostname, name: 'tiny-idp' },
      user: { id: user.id, name: user.email, displayName: user.email },
      // ES256 first, RS256 as the fallback: the algorithms this server could verify.
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
    }
  })
}
