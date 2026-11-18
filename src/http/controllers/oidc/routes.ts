import type { FastifyInstance } from 'fastify'

import { env } from '@/env'
import { requireBearer } from '@/http/require-bearer'
import { SUPPORTED_SCOPES } from '@/oauth/clients'
import { getJwks, SIGNING_ALG } from '@/oidc/keys'

export async function oidcRoutes(app: FastifyInstance) {
  // One URL from which a client learns every endpoint and setting, given only the issuer.
  // `issuer` must equal the `iss` of every ID token, character for character.
  app.get('/.well-known/openid-configuration', async () => ({
    issuer: env.ISSUER,
    authorization_endpoint: `${env.ISSUER}/authorize`,
    token_endpoint: `${env.ISSUER}/token`,
    userinfo_endpoint: `${env.ISSUER}/userinfo`,
    jwks_uri: `${env.ISSUER}/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [SIGNING_ALG],
    scopes_supported: SUPPORTED_SCOPES,
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'email'],
  }))

  app.get('/jwks.json', async () => getJwks())

  // Claims about the user, protected by the access token. `sub` must match the ID token's.
  app.get('/userinfo', async (request) => {
    const { user, token } = requireBearer(request, 'openid')

    return {
      sub: user.id,
      // Claims are released per scope: no `email` scope, no email.
      ...(token.scope.includes('email') && { email: user.email }),
    }
  })
}
