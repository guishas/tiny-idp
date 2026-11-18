import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { can, holdsAll } from '@/authz/can'
import { PERMISSIONS } from '@/authz/permissions'
import { HttpError } from '@/http/http-error'
import { getOrg } from '@/http/org-context'
import { emailSchema } from '@/http/schemas'
import { parseBody } from '@/http/validate'
import { type Delegation, usersByEmail } from '@/store'

const MAX_DELEGATION_SECONDS = 7 * 24 * 60 * 60

const createDelegationSchema = z.object({
  toEmail: emailSchema,
  permissions: z.array(z.enum(PERMISSIONS)).min(1),
  // Always temporary: forgotten standing access is the dangerous kind. Renewing means creating a
  // new delegation, which is a new decision.
  expiresInSeconds: z.number().int().min(1).max(MAX_DELEGATION_SECONDS),
})

const delegationParamsSchema = z.object({ id: z.string() })

export async function delegationRoutes(app: FastifyInstance) {
  // Any member can delegate, but only what their OWN role holds. A permission received through a
  // delegation does not count, which is why delegations cannot be chained.
  app.post('/orgs/:orgId/delegations', async (request, reply) => {
    const { user, org } = getOrg(request)
    const { toEmail, permissions, expiresInSeconds } = parseBody(
      createDelegationSchema,
      request.body,
    )

    if (!holdsAll(org, user.id, permissions)) throw new HttpError(403, 'forbidden')

    // A missing user and a user outside this org look the same: neither is a valid recipient.
    const grantee = usersByEmail.get(toEmail)
    if (!grantee || !org.members.has(grantee.id)) throw new HttpError(404, 'not_found')
    if (grantee.id === user.id) throw new HttpError(400, 'invalid_request')

    const now = Date.now()
    const delegation: Delegation = {
      id: randomUUID(),
      grantorId: user.id,
      granteeId: grantee.id,
      permissions: [...new Set(permissions)],
      createdAt: now,
      expiresAt: now + expiresInSeconds * 1000,
    }
    org.delegations.set(delegation.id, delegation)

    return reply
      .code(201)
      .send({ id: delegation.id, expiresAt: new Date(delegation.expiresAt).toISOString() })
  })

  app.delete('/orgs/:orgId/delegations/:id', async (request, reply) => {
    const { user, org } = getOrg(request)
    const { id } = parseBody(delegationParamsSchema, request.params)

    const delegation = org.delegations.get(id)
    if (!delegation) throw new HttpError(404, 'not_found')

    // Whoever granted it can always take it back; so can anyone allowed to manage delegations.
    const mayRevoke =
      delegation.grantorId === user.id || can(org, user.id, 'delegation:manage').allowed
    if (!mayRevoke) throw new HttpError(403, 'forbidden')

    delegation.revokedAt ??= Date.now()

    return reply.code(204).send()
  })
}
