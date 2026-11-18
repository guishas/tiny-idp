import { sign } from 'node:crypto'

import { SIGNING_ALG, signingKey } from '@/oidc/keys'

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

// A JWT is three base64url parts joined by dots: header.payload.signature.
// The signature covers the first two parts, so changing any claim invalidates it.
export function signJwt(payload: Record<string, unknown>) {
  const header = { alg: SIGNING_ALG, typ: 'JWT', kid: signingKey.kid }
  const signingInput = `${encode(header)}.${encode(payload)}`

  const signature = sign('RSA-SHA256', Buffer.from(signingInput), signingKey.privateKey)

  return `${signingInput}.${signature.toString('base64url')}`
}
