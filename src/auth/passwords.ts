import { randomBytes } from 'node:crypto'

// argon2id is memory-hard, so brute-forcing a leaked hash is expensive. Bun generates a random
// salt per hash and embeds it (with the parameters) in the resulting string.
const ARGON2 = { algorithm: 'argon2id' } as const

export function hashPassword(password: string) {
  return Bun.password.hash(password, ARGON2)
}

export function verifyPassword(password: string, hash: string) {
  return Bun.password.verify(password, hash)
}

// A valid hash of a random password nobody knows, generated once at startup.
//
// When someone logs in with an email that does not exist, we still verify the password against
// this hash. Otherwise "unknown user" would answer in microseconds and "wrong password" in
// ~100ms, and an attacker could tell which emails are registered just by measuring the time.
export const DUMMY_HASH = await hashPassword(randomBytes(32).toString('hex'))
