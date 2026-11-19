import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { audit, denied, onBehalfOf } from '@/audit/audit'
import { holdsAll } from '@/authz/can'
import { PERMISSIONS } from '@/authz/permissions'
import { HttpError } from '@/http/http-error'
import { authorize, getOrg } from '@/http/org-context'
import { requireUser } from '@/http/require-user'
import { emailSchema } from '@/http/schemas'
import { parseBody } from '@/http/validate'
import { type Org, orgs, type Role, usersByEmail } from '@/store'

const createOrgSchema = z.object({ name: z.string().trim().min(1).max(100) })

// z.enum is what turns an unknown permission into a 400 without any extra code.
const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(64),
  permissions: z.array(z.enum(PERMISSIONS)),
})

const addMemberSchema = z.object({ email: emailSchema, roleId: z.string() })
const changeMemberSchema = z.object({ roleId: z.string() })
const memberParamsSchema = z.object({ userId: z.string() })

// The role must exist in THIS org: a role id from another org is a request error, not a lookup.
function findRole(org: Org, roleId: string) {
  const role = org.roles.get(roleId)
  if (!role) throw new HttpError(400, 'invalid_role')

  return role
}

export async function orgRoutes(app: FastifyInstance) {
  app.post('/orgs', async (request, reply) => {
    const { user } = requireUser(request)
    const { name } = parseBody(createOrgSchema, request.body)

    // The built-in owner role is plain data: every permission. No code ever looks at its name.
    const owner: Role = { id: randomUUID(), name: 'owner', permissions: [...PERMISSIONS] }

    const org: Org = {
      id: randomUUID(),
      name,
      roles: new Map([[owner.id, owner]]),
      members: new Map([[user.id, owner.id]]),
      invoices: new Map(),
      delegations: new Map(),
      audit: [],
    }
    orgs.set(org.id, org)

    return reply.code(201).send({ id: org.id, name: org.name })
  })

  app.get('/orgs/:orgId', async (request) => {
    const { org } = getOrg(request)

    return { id: org.id, name: org.name }
  })

  app.post('/orgs/:orgId/roles', async (request, reply) => {
    const { user, org } = getOrg(request)

    // Permission first, validation second: an unauthorized caller learns nothing about the rules.
    const attempt = { action: 'role.created', resource: `org:${org.id}` } as const
    const decision = authorize(request, org, user.id, 'role:manage', attempt)
    const { name, permissions } = parseBody(createRoleSchema, request.body)

    // Anti-escalation: nobody can create a role more powerful than their own.
    if (!holdsAll(org, user.id, permissions)) throw denied(request, org, user.id, attempt)

    const taken = [...org.roles.values()].some((r) => r.name.toLowerCase() === name.toLowerCase())
    if (taken) throw new HttpError(409, 'role_name_taken')

    const role: Role = { id: randomUUID(), name, permissions: [...new Set(permissions)] }
    org.roles.set(role.id, role)

    audit(request, org, {
      actor: user.id,
      action: 'role.created',
      resource: `role:${role.id}`,
      outcome: 'success',
      onBehalfOf: onBehalfOf(decision),
    })

    return reply.code(201).send(role)
  })

  app.post('/orgs/:orgId/members', async (request, reply) => {
    const { user, org } = getOrg(request)

    const attempt = { action: 'member.added', resource: `org:${org.id}` } as const
    const decision = authorize(request, org, user.id, 'member:manage', attempt)
    const { email, roleId } = parseBody(addMemberSchema, request.body)

    const role = findRole(org, roleId)
    if (!holdsAll(org, user.id, role.permissions)) throw denied(request, org, user.id, attempt)

    const member = usersByEmail.get(email)
    if (!member) throw new HttpError(404, 'user_not_found')
    if (org.members.has(member.id)) throw new HttpError(409, 'already_member')

    org.members.set(member.id, role.id)

    audit(request, org, {
      actor: user.id,
      subject: member.id,
      action: 'member.added',
      resource: `org:${org.id}`,
      outcome: 'success',
      onBehalfOf: onBehalfOf(decision),
    })

    return reply.code(201).send({ userId: member.id, email: member.email, roleId: role.id })
  })

  app.put('/orgs/:orgId/members/:userId', async (request) => {
    const { user, org } = getOrg(request)

    authorize(request, org, user.id, 'member:manage')
    const { userId } = parseBody(memberParamsSchema, request.params)
    const { roleId } = parseBody(changeMemberSchema, request.body)

    const role = findRole(org, roleId)

    const currentRoleId = org.members.get(userId)
    const currentRole = currentRoleId ? org.roles.get(currentRoleId) : undefined
    if (!currentRole) throw new HttpError(404, 'not_found')

    // Two ceilings: you cannot hand out a role above your own, and you cannot touch a member
    // who is above you. Otherwise a member:manage holder could demote the owner.
    const withinCeiling =
      holdsAll(org, user.id, role.permissions) && holdsAll(org, user.id, currentRole.permissions)
    if (!withinCeiling) throw new HttpError(403, 'forbidden')

    org.members.set(userId, role.id)

    return { userId, roleId: role.id }
  })
}
