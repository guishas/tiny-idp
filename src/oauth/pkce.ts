import { createHash, timingSafeEqual } from 'node:crypto'

// RFC 7636: a verifier is 43 to 128 unreserved characters. A challenge is the unpadded
// base64url of a SHA-256 digest, which is always exactly 43 characters.
const VERIFIER_FORMAT = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE_FORMAT = /^[A-Za-z0-9_-]{43}$/

export const isValidChallenge = (challenge: string) => CHALLENGE_FORMAT.test(challenge)

// Proves that whoever redeems the code is the same party that started the flow: only that party
// knows the verifier, and the challenge stored at /authorize cannot be reversed into it.
export function verifyPkce(verifier: string, challenge: string) {
  if (!VERIFIER_FORMAT.test(verifier)) return false

  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const expected = Buffer.from(challenge)

  return computed.length === expected.length && timingSafeEqual(computed, expected)
}
