import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// RFC 6238 with the defaults every authenticator app uses: HMAC-SHA1, 6 digits, 30-second steps.
const STEP_MS = 30_000
const DIGITS = 6

// 160 bits, the size RFC 4226 recommends for an HMAC-SHA1 key.
export function generateTotpSecret() {
  return randomBytes(20)
}

export function counterAt(nowMs: number) {
  return Math.floor(nowMs / STEP_MS)
}

// HOTP (RFC 4226) with the time step as the counter: HMAC the 8-byte counter, then "dynamic
// truncation": the last nibble picks an offset, 4 bytes from there become a 31-bit number.
export function totpCode(secret: Uint8Array, counter: number) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))

  const hmac = createHmac('sha1', secret).update(message).digest()
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

function codesMatch(expected: string, received: string) {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)

  return a.length === b.length && timingSafeEqual(a, b)
}

// Returns the step the code belongs to, or null. Accepts the current step plus one on each side
// (clock drift and typing time). `lastUsedCounter` is the anti-replay floor: a code from a step at
// or below it was already spent, so even a correct code is refused.
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  lastUsedCounter: number,
) {
  const current = counterAt(nowMs)
  let accepted: number | null = null

  // Every candidate is always checked, so response time does not reveal which one matched.
  for (const counter of [current - 1, current, current + 1]) {
    if (codesMatch(totpCode(secret, counter), code) && counter > lastUsedCounter) {
      accepted = counter
    }
  }

  return accepted
}
