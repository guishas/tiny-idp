import { randomBytes } from 'node:crypto'

// 32 random bytes = 256 bits of entropy, as an unpadded base64url string (43 chars).
// Used for every secret the server hands out: session ids, codes and tokens.
export function randomToken() {
  return randomBytes(32).toString('base64url')
}
