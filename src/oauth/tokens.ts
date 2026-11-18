import { randomToken } from '@/lib/random'
import {
  accessTokens,
  authorizationCodes,
  refreshTokens,
  type TokenFamily,
  tokenFamilies,
} from '@/store'

const AUTHORIZATION_CODE_TTL_MS = 60 * 1000
const ACCESS_TOKEN_TTL_SECONDS = 10 * 60
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
  id_token?: string
}

export function issueAuthorizationCode(input: {
  clientId: string
  redirectUri: string
  codeChallenge: string
  userId: string
  scope: string[]
  nonce?: string
  authTime: number
}) {
  const code = randomToken()

  authorizationCodes.set(code, {
    ...input,
    code,
    expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS,
    used: false,
  })

  return code
}

export function createFamily(userId: string, clientId: string, scope: string[]) {
  const family: TokenFamily = { id: randomToken(), userId, clientId, scope, revoked: false }
  tokenFamilies.set(family.id, family)

  return family
}

export function revokeFamily(familyId: string) {
  const family = tokenFamilies.get(familyId)
  if (family) family.revoked = true
}

// Issues a new access/refresh pair inside a family. `scope` may be narrower than the family's.
export function issueTokens(family: TokenFamily, scope: string[] = family.scope): TokenResponse {
  const now = Date.now()

  const accessToken = randomToken()
  accessTokens.set(accessToken, {
    token: accessToken,
    familyId: family.id,
    scope,
    expiresAt: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
  })

  const refreshToken = randomToken()
  refreshTokens.set(refreshToken, {
    token: refreshToken,
    familyId: family.id,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
    used: false,
  })

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scope.join(' '),
  }
}

// An access token is only valid while it has not expired AND its family has not been revoked.
export function findAccessToken(value: string) {
  const token = accessTokens.get(value)
  if (!token) return undefined

  if (token.expiresAt <= Date.now()) {
    accessTokens.delete(value)
    return undefined
  }

  const family = tokenFamilies.get(token.familyId)
  if (!family || family.revoked) return undefined

  return { token, family }
}
