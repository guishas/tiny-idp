import type { FastifyRequest } from 'fastify'

import { HttpError } from '@/http/http-error'
import { findAccessToken } from '@/oauth/tokens'
import { users } from '@/store'

// RFC 6750: the WWW-Authenticate header tells the client why the token was refused.
const challenge = (params = '') => ({ 'www-authenticate': `Bearer${params}` })

// Resolves the user behind an `Authorization: Bearer` access token and checks it carries `scope`.
// Used by protected resources, as opposed to `requireUser`, which reads the browser session cookie.
export function requireBearer(request: FastifyRequest, scope: string) {
  const header = request.headers.authorization
  if (!header) throw new HttpError(401, 'unauthorized', challenge())

  const value = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  const found = value ? findAccessToken(value) : undefined
  const user = found ? users.get(found.family.userId) : undefined

  if (!found || !user) {
    throw new HttpError(401, 'invalid_token', challenge(' error="invalid_token"'))
  }

  if (!found.token.scope.includes(scope)) {
    throw new HttpError(
      403,
      'insufficient_scope',
      challenge(` error="insufficient_scope", scope="${scope}"`),
    )
  }

  return { user, token: found.token }
}
