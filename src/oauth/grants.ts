import { HttpError } from '@/http/http-error'
import { findClient, isScopeAllowed, splitScope } from '@/oauth/clients'
import { verifyPkce } from '@/oauth/pkce'
import { createFamily, issueTokens, revokeFamily } from '@/oauth/tokens'
import { authorizationCodes, refreshTokens, tokenFamilies } from '@/store'

// RFC 6749 section 5.2: every failure to redeem a code or refresh token looks the same.
const invalidGrant = () => new HttpError(400, 'invalid_grant')

function requireClient(clientId: string) {
  const client = findClient(clientId)
  if (!client) throw new HttpError(400, 'invalid_client')

  return client
}

export function exchangeAuthorizationCode(input: {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
}) {
  const client = requireClient(input.clientId)

  const record = authorizationCodes.get(input.code)
  if (!record) throw invalidGrant()

  // A code that comes back a second time means someone else may hold it: revoke what it issued.
  if (record.used) {
    if (record.familyId) revokeFamily(record.familyId)
    throw invalidGrant()
  }

  // Burn the code BEFORE any other check, so a failed attempt (wrong verifier, wrong redirect)
  // cannot be retried with guesses.
  record.used = true

  if (record.expiresAt <= Date.now()) throw invalidGrant()
  if (record.clientId !== client.id) throw invalidGrant()
  if (record.redirectUri !== input.redirectUri) throw invalidGrant()
  if (!verifyPkce(input.codeVerifier, record.codeChallenge)) throw invalidGrant()

  const family = createFamily(record.userId, record.clientId, record.scope)
  record.familyId = family.id

  return issueTokens(family)
}

export function refreshTokenGrant(input: {
  clientId: string
  refreshToken: string
  scope?: string
}) {
  const client = requireClient(input.clientId)

  const record = refreshTokens.get(input.refreshToken)
  if (!record) throw invalidGrant()

  const family = tokenFamilies.get(record.familyId)
  if (!family || family.revoked || family.clientId !== client.id) throw invalidGrant()

  // Rotation: each refresh token works exactly once. Seeing a used one again means the token
  // leaked, and the legitimate client and the thief both hold a copy, so the whole family dies.
  if (record.used) {
    revokeFamily(family.id)
    throw invalidGrant()
  }

  if (record.expiresAt <= Date.now()) throw invalidGrant()

  // A refresh may ask for LESS than was originally granted, never for more.
  const scope = input.scope === undefined ? family.scope : splitScope(input.scope)
  if (!isScopeAllowed(scope, family.scope)) throw new HttpError(400, 'invalid_scope')

  record.used = true

  return issueTokens(family, scope)
}
