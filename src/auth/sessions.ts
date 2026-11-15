import { randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'

import { env } from '@/env'
import { type Session, sessions } from '@/store'

export const SESSION_COOKIE = 'sid'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days, absolute (it does not slide)

export function createSession(userId: string): Session {
  const now = Date.now()

  const session: Session = {
    // 32 random bytes = 256 bits of entropy: impossible to guess or enumerate.
    id: randomBytes(32).toString('base64url'),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  }

  sessions.set(session.id, session)
  return session
}

export function findSession(sessionId: string | undefined): Session | undefined {
  if (!sessionId) return undefined

  const session = sessions.get(sessionId)
  if (!session) return undefined

  // The cookie's Max-Age is only a hint to the browser; a client can ignore it. The real
  // expiry is enforced here, and expired sessions are removed as they are found.
  if (session.expiresAt <= Date.now()) {
    sessions.delete(session.id)
    return undefined
  }

  return session
}

// Logging out must kill the session on the SERVER. Just clearing the cookie would leave a stolen
// copy of it valid until it expires.
export function destroySession(sessionId: string | undefined) {
  if (sessionId) sessions.delete(sessionId)
}

export function setSessionCookie(reply: FastifyReply, session: Session) {
  reply.setCookie(SESSION_COOKIE, session.id, {
    httpOnly: true, // not readable by JavaScript, so an XSS bug cannot steal it
    sameSite: 'lax', // not sent on cross-site POSTs, which blocks most CSRF
    secure: env.NODE_ENV === 'production', // HTTPS only in production
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}
