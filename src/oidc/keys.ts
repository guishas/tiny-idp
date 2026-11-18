import { generateKeyPairSync, randomUUID } from 'node:crypto'

export const SIGNING_ALG = 'RS256'

// A fresh key pair is generated on every boot, so tokens signed before a restart stop verifying.
// Acceptable for an in-memory learning project; a real provider would persist and rotate keys.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

export const signingKey = { kid: randomUUID(), privateKey }

// Only the PUBLIC half is ever exported. `kid` is how a verifier picks the right key from the
// set, which is also what makes key rotation possible.
export function getJwks() {
  return {
    keys: [
      { ...publicKey.export({ format: 'jwk' }), kid: signingKey.kid, alg: SIGNING_ALG, use: 'sig' },
    ],
  }
}
