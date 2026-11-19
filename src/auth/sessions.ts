import type { FastifyReply } from 'fastify'

import { env } from '@/env'
import { randomToken } from '@/lib/random'
import { type Session, sessions } from '@/store'

export const SESSION_COOKIE = 'sid'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days, absolute (it does not slide)

export function createSession(userId: string): Session {
  const now = Date.now()

  const session: Session = {
    id: randomToken(),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    acr: 'pwd',
    authTime: now,
  }

  sessions.set(session.id, session)
  return session
}

// Step-up succeeded: the same login, now at a higher assurance level. The session id is rotated,
// like on login, so an id captured while the session was weaker is worthless afterwards. The
// absolute expiry is kept: proving a second factor does not buy a longer session.
export function elevateSession(current: Session): Session {
  const elevated: Session = {
    id: randomToken(),
    userId: current.userId,
    createdAt: current.createdAt,
    expiresAt: current.expiresAt,
    acr: 'mfa',
    authTime: Date.now(),
  }

  sessions.delete(current.id)
  sessions.set(elevated.id, elevated)

  return elevated
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
    maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
  })
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}
