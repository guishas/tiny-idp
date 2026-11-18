import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { DUMMY_HASH, hashPassword, verifyPassword } from '@/auth/passwords'
import {
  clearSessionCookie,
  createSession,
  destroySession,
  SESSION_COOKIE,
  setSessionCookie,
} from '@/auth/sessions'
import { HttpError } from '@/http/http-error'
import { requireUser } from '@/http/require-user'
import { emailSchema } from '@/http/schemas'
import { parseBody } from '@/http/validate'
import { type User, users, usersByEmail } from '@/store'

const registerSchema = z.object({
  email: emailSchema,
  // A minimum length is the single most effective password rule (OWASP). The maximum only exists
  // so that nobody can make the server hash megabytes of input.
  password: z.string().min(12).max(128),
})

// On login the password rules are NOT re-applied: a wrong password must always end in the same
// 401, never in a 400 that would reveal the rules (or that an account exists).
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

// The public view of a user. Built field by field so the hash can never leak by accident.
const toPublicUser = (user: User) => ({ id: user.id, email: user.email })

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const { email, password } = parseBody(registerSchema, request.body)

    if (usersByEmail.has(email)) throw new HttpError(409, 'email_taken')

    const passwordHash = await hashPassword(password)

    // Hashing is async, so another request may have registered the same email while we were
    // waiting. Check again, synchronously right before writing, to keep the email unique.
    if (usersByEmail.has(email)) throw new HttpError(409, 'email_taken')

    const user: User = { id: randomUUID(), email, passwordHash, createdAt: Date.now() }
    users.set(user.id, user)
    usersByEmail.set(user.email, user)

    return reply.code(201).send(toPublicUser(user))
  })

  app.post('/login', async (request, reply) => {
    const { email, password } = parseBody(loginSchema, request.body)

    const user = usersByEmail.get(email)

    // Always run a hash verification, even for unknown emails (see DUMMY_HASH), so both failure
    // modes cost the same time and return the same response.
    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)

    if (!user || !passwordMatches) throw new HttpError(401, 'invalid_credentials')

    // Session fixation defense: never reuse a session id that came with the request. An attacker
    // who planted a known id in the victim's browser must not benefit from the victim logging in.
    destroySession(request.cookies[SESSION_COOKIE])

    setSessionCookie(reply, createSession(user.id))

    return toPublicUser(user)
  })

  app.get('/me', async (request) => {
    const { user } = requireUser(request)

    return toPublicUser(user)
  })

  // Idempotent on purpose: logging out without a valid session is not an error.
  app.post('/logout', async (request, reply) => {
    destroySession(request.cookies[SESSION_COOKIE])
    clearSessionCookie(reply)

    return reply.code(204).send()
  })
}
