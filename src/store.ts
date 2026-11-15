// In-memory storage. There is no database on purpose: the point of this project is the identity
// logic, not persistence. Everything here is lost when the process restarts.

export interface User {
  id: string
  // Always stored normalized (trimmed and lowercased), see `emailSchema`.
  email: string
  // argon2id hash, including its own salt and parameters. The plain password is never stored.
  passwordHash: string
  createdAt: number
}

export interface Session {
  // Random, unguessable identifier. It is the value of the `sid` cookie.
  id: string
  userId: string
  createdAt: number
  // Absolute expiry (epoch ms). The server enforces it, not just the cookie.
  expiresAt: number
}

export const users = new Map<string, User>()
export const usersByEmail = new Map<string, User>()
export const sessions = new Map<string, Session>()
