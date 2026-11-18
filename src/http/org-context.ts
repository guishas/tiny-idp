import type { FastifyRequest } from 'fastify'
import { z } from 'zod'

import { can } from '@/authz/can'
import type { Permission } from '@/authz/permissions'
import { HttpError } from '@/http/http-error'
import { requireUser } from '@/http/require-user'
import { parseBody } from '@/http/validate'
import { type Org, orgs } from '@/store'

const orgParamsSchema = z.object({ orgId: z.string() })

// Loads the org named in the URL on behalf of the logged-in user. A non-member gets the same 404
// as an org that does not exist, so the response never reveals which orgs exist.
export function getOrg(request: FastifyRequest) {
  const { user } = requireUser(request)
  const { orgId } = parseBody(orgParamsSchema, request.params)

  const org = orgs.get(orgId)
  if (!org?.members.has(user.id)) throw new HttpError(404, 'not_found')

  return { user, org }
}

// Enforcement: turns the decision of `can()` into a 403. Routes never decide permissions on
// their own. They return the decision so later milestones can record how it was reached.
export function authorize(org: Org, userId: string, permission: Permission) {
  const decision = can(org, userId, permission)
  if (!decision.allowed) throw new HttpError(403, 'forbidden')

  return decision
}
