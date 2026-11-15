import type { FastifyRequest } from 'fastify'

import { findSession, SESSION_COOKIE } from '@/auth/sessions'
import { HttpError } from '@/http/http-error'
import { type Session, type User, users } from '@/store'

// Resolves the logged-in user from the session cookie, or throws 401.
// Every authenticated route in the following milestones starts with this call.
export function requireUser(request: FastifyRequest): { user: User; session: Session } {
  const session = findSession(request.cookies[SESSION_COOKIE])
  const user = session ? users.get(session.userId) : undefined

  if (!session || !user) throw new HttpError(401, 'unauthorized')

  return { user, session }
}
