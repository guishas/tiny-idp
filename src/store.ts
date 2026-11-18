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

export interface AuthorizationCode {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  userId: string
  scope: string[]
  // OIDC: echoed into the ID token to tie it to this login attempt.
  nonce?: string
  // When the user logged in (epoch seconds), taken from the session that approved the request.
  authTime: number
  expiresAt: number
  // Set as soon as the code is presented, even if the exchange then fails.
  used: boolean
  // Filled once tokens are issued, so a replay of the code can revoke them.
  familyId?: string
}

// All tokens derived from one authorization code share a family. Revoking the family
// invalidates every access and refresh token in it at once.
export interface TokenFamily {
  id: string
  userId: string
  clientId: string
  scope: string[]
  revoked: boolean
}

export interface AccessToken {
  token: string
  familyId: string
  scope: string[]
  expiresAt: number
}

export interface RefreshToken {
  token: string
  familyId: string
  expiresAt: number
  used: boolean
}

export const users = new Map<string, User>()
export const usersByEmail = new Map<string, User>()
export const sessions = new Map<string, Session>()

export const authorizationCodes = new Map<string, AuthorizationCode>()
export const tokenFamilies = new Map<string, TokenFamily>()
export const accessTokens = new Map<string, AccessToken>()
export const refreshTokens = new Map<string, RefreshToken>()
