import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { authorize, getOrg } from '@/http/org-context'
import { parseBody } from '@/http/validate'

const MAX_LIMIT = 200

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
})

// Read-only on purpose. There is no route to change or delete an event, so the HTTP surface
// itself is append-only: the only writer is `audit()`, called from the routes that act.
export async function auditRoutes(app: FastifyInstance) {
  app.get('/orgs/:orgId/audit', async (request) => {
    const { user, org } = getOrg(request)
    const { limit } = parseBody(auditQuerySchema, request.query)

    authorize(request, org, user.id, 'audit:read')

    // Events are appended in time order, so the newest are at the end of the array.
    return org.audit.slice(-limit).reverse()
  })
}
