import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import fastify from 'fastify'

import { env } from '@/env'
import { apiRoutes } from '@/http/controllers/api/routes'
import { authRoutes } from '@/http/controllers/auth/routes'
import { mfaRoutes } from '@/http/controllers/mfa/routes'
import { webauthnRoutes } from '@/http/controllers/mfa/webauthn-routes'
import { oauthRoutes } from '@/http/controllers/oauth/routes'
import { oidcRoutes } from '@/http/controllers/oidc/routes'
import { auditRoutes } from '@/http/controllers/orgs/audit-routes'
import { delegationRoutes } from '@/http/controllers/orgs/delegation-routes'
import { invoiceRoutes } from '@/http/controllers/orgs/invoice-routes'
import { orgRoutes } from '@/http/controllers/orgs/routes'
import { errorHandler, notFoundHandler } from '@/http/error-handler'
import { generateRequestId } from '@/http/request-id'

export const app = fastify({
  // Request logs never include bodies or cookies, so passwords and session ids stay out of them.
  logger: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
  // Reuses a well-formed X-Request-Id from the caller, otherwise generates one.
  genReqId: generateRequestId,
})

// Every response carries its request id, so a client can quote it and find the audit events.
app.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id)
})

app.setErrorHandler(errorHandler)
app.setNotFoundHandler(notFoundHandler)

await app.register(cookie)
await app.register(formbody) // /token receives application/x-www-form-urlencoded

// Liveness probe.
app.get('/health', async () => ({ status: 'ok' }))

// Milestone 1: registration, login, sessions.
await app.register(authRoutes)

// Milestone 2: OAuth 2.0 authorization server and a protected resource to try tokens on.
await app.register(oauthRoutes)
await app.register(apiRoutes)

// Milestone 3: OpenID Connect on top of the OAuth server (discovery, keys, userinfo).
await app.register(oidcRoutes)

// Milestone 4: multi-tenant organizations, custom roles, invoices and delegation.
await app.register(orgRoutes)
await app.register(invoiceRoutes)
await app.register(delegationRoutes)

// Milestone 5: TOTP second factor, step-up (enforced inside the approve route) and the audit trail.
await app.register(mfaRoutes)
await app.register(webauthnRoutes)
await app.register(auditRoutes)
