import type { FastifyInstance } from 'fastify'

import { requireBearer } from '@/http/require-bearer'

// The protected resource. It only trusts access tokens, never the browser session cookie.
export async function apiRoutes(app: FastifyInstance) {
  app.get('/api/profile', async (request) => {
    const { user } = requireBearer(request, 'profile')

    return { id: user.id, email: user.email }
  })
}
