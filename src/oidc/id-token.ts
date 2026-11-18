import { env } from '@/env'
import { signJwt } from '@/oidc/jwt'

const ID_TOKEN_TTL_SECONDS = 10 * 60

// The ID token is addressed to the client (`aud`), which reads it to learn who logged in.
// It is not a credential for calling APIs: that is the access token's job.
export function createIdToken(input: {
  userId: string
  clientId: string
  authTime: number
  nonce?: string
}) {
  const now = Math.floor(Date.now() / 1000)

  return signJwt({
    iss: env.ISSUER,
    // The user's stable, opaque id. Never the email, which can change or be reassigned.
    sub: input.userId,
    aud: input.clientId,
    exp: now + ID_TOKEN_TTL_SECONDS,
    iat: now,
    auth_time: input.authTime,
    // Echoes the value the client sent, tying this token to one specific login attempt.
    ...(input.nonce && { nonce: input.nonce }),
  })
}
