import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

import type { Decision } from '@/authz/can'
import { HttpError } from '@/http/http-error'
import type { AuditAction, AuditOutcome, Org } from '@/store'

// What the action is about. `resource` is a typed id such as `invoice:<id>`, never a free value.
export interface AuditTarget {
  action: AuditAction
  resource: string
  subject?: string
}

interface AuditInput extends AuditTarget {
  actor: string
  outcome: AuditOutcome
  onBehalfOf?: string
}

// The single way an event enters the trail. Routes call it on success AND on refusals: a denied
// attempt is often the most interesting line in the log.
export function audit(request: FastifyRequest, org: Org, input: AuditInput) {
  org.audit.push(
    Object.freeze({
      id: randomUUID(),
      ts: new Date().toISOString(),
      actor: input.actor,
      subject: input.subject ?? null,
      on_behalf_of: input.onBehalfOf ?? null,
      action: input.action,
      resource: input.resource,
      outcome: input.outcome,
      request_id: request.id,
    }),
  )
}

// Records the refused attempt and returns the 403 to throw, so recording and refusing cannot drift
// apart: `throw denied(...)`.
export function denied(request: FastifyRequest, org: Org, actor: string, target: AuditTarget) {
  audit(request, org, { ...target, actor, outcome: 'denied' })

  return new HttpError(403, 'forbidden')
}

// Only set when the permission came from someone else's delegation: that is the fact an auditor
// needs, because the actor alone would hide who really granted the power.
export function onBehalfOf(decision: Decision) {
  return decision.allowed && decision.via === 'delegation' ? decision.delegatorId : undefined
}
