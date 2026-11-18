export const SUPPORTED_SCOPES = ['profile', 'email', 'openid'] as const

export interface OAuthClient {
  id: string
  // Compared by exact string equality, never by prefix or pattern.
  redirectUri: string
  scopes: readonly string[]
}

// The only registered client: a public client (no secret), which in practice is the dev console.
const demoClient: OAuthClient = {
  id: 'demo-client',
  redirectUri: 'http://localhost:4000/callback',
  scopes: SUPPORTED_SCOPES,
}

const clients = new Map([[demoClient.id, demoClient]])

export function findClient(clientId: string | undefined) {
  return clientId ? clients.get(clientId) : undefined
}

export function splitScope(raw: string) {
  return [...new Set(raw.split(' ').filter(Boolean))]
}

export function isScopeAllowed(scope: string[], allowed: readonly string[]) {
  return scope.length > 0 && scope.every((item) => allowed.includes(item))
}
