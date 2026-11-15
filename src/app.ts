import cookie from '@fastify/cookie'
import fastify from 'fastify'

import { env } from '@/env'
import { authRoutes } from '@/http/controllers/auth/routes'
import { errorHandler, notFoundHandler } from '@/http/error-handler'

export const app = fastify({
  // Request logs never include bodies or cookies, so passwords and session ids stay out of them.
  logger: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
})

app.setErrorHandler(errorHandler)
app.setNotFoundHandler(notFoundHandler)

await app.register(cookie)

// Liveness probe.
app.get('/health', async () => ({ status: 'ok' }))

// Milestone 1: registration, login, sessions.
await app.register(authRoutes)
