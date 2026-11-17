import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { findSession, SESSION_COOKIE } from '@/auth/sessions'
import { HttpError } from '@/http/http-error'
import { parseBody } from '@/http/validate'
import { findClient, isScopeAllowed, splitScope } from '@/oauth/clients'
import { exchangeAuthorizationCode, refreshTokenGrant } from '@/oauth/grants'
import { isValidChallenge } from '@/oauth/pkce'
import { issueAuthorizationCode } from '@/oauth/tokens'

const authorizeQuerySchema = z.object({
  response_type: z.string().optional(),
  client_id: z.string().optional(),
  redirect_uri: z.string().optional(),
  scope: z.string().optional(),
  state: z.string().max(512).optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
})

const tokenRequestSchema = z.object({ grant_type: z.string() })

const authorizationCodeGrantSchema = z.object({
  client_id: z.string(),
  code: z.string(),
  redirect_uri: z.string(),
  code_verifier: z.string(),
})

const refreshTokenGrantSchema = z.object({
  client_id: z.string(),
  refresh_token: z.string(),
  scope: z.string().optional(),
})

function buildRedirect(base: string, params: Record<string, string | undefined>) {
  const url = new URL(base)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  return url.toString()
}

export async function oauthRoutes(app: FastifyInstance) {
  app.get('/authorize', async (request, reply) => {
    const query = parseBody(authorizeQuerySchema, request.query)

    // client_id and redirect_uri come first and fail WITHOUT redirecting: until they check out,
    // the redirect_uri is attacker-controlled and redirecting to it would make us an open redirector.
    const client = findClient(query.client_id)
    if (!client || query.redirect_uri !== client.redirectUri) {
      throw new HttpError(400, 'invalid_request')
    }

    // From here on the redirect_uri is trusted, so errors are reported to the client through it.
    const redirectError = (error: string) =>
      reply.redirect(buildRedirect(client.redirectUri, { error, state: query.state }))

    if (query.response_type !== 'code') return redirectError('unsupported_response_type')

    // PKCE is mandatory and S256 is the only method: "plain" sends the secret itself.
    if (
      !query.code_challenge ||
      !isValidChallenge(query.code_challenge) ||
      query.code_challenge_method !== 'S256'
    ) {
      return redirectError('invalid_request')
    }

    const scope = splitScope(query.scope ?? '')
    if (!isScopeAllowed(scope, client.scopes)) return redirectError('invalid_scope')

    const session = findSession(request.cookies[SESSION_COOKIE])
    if (!session) {
      return reply.redirect(`/login?return_to=${encodeURIComponent(request.url)}`)
    }

    // Consent is granted automatically: this server only knows one trusted first-party client.
    const code = issueAuthorizationCode({
      clientId: client.id,
      redirectUri: client.redirectUri,
      codeChallenge: query.code_challenge,
      userId: session.userId,
      scope,
    })

    return reply.redirect(buildRedirect(client.redirectUri, { code, state: query.state }))
  })

  app.post('/token', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('pragma', 'no-cache')

    const { grant_type: grantType } = parseBody(tokenRequestSchema, request.body)

    switch (grantType) {
      case 'authorization_code': {
        const body = parseBody(authorizationCodeGrantSchema, request.body)

        return exchangeAuthorizationCode({
          clientId: body.client_id,
          code: body.code,
          redirectUri: body.redirect_uri,
          codeVerifier: body.code_verifier,
        })
      }

      case 'refresh_token': {
        const body = parseBody(refreshTokenGrantSchema, request.body)

        return refreshTokenGrant({
          clientId: body.client_id,
          refreshToken: body.refresh_token,
          scope: body.scope,
        })
      }

      default:
        throw new HttpError(400, 'unsupported_grant_type')
    }
  })
}
