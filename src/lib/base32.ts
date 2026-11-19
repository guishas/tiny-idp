const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// RFC 4648 base32, the encoding authenticator apps expect for the shared secret. Only encoding is
// needed here: the server keeps the raw bytes and encodes them once, at enrollment.
export function base32Encode(bytes: Uint8Array) {
  let output = ''
  let buffer = 0
  let bits = 0

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += ALPHABET.charAt((buffer >>> (bits - 5)) & 31)
      bits -= 5
    }

    buffer &= (1 << bits) - 1
  }

  if (bits > 0) output += ALPHABET.charAt((buffer << (5 - bits)) & 31)

  return output
}
