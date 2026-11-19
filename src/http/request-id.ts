import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

// The id comes from a header the client controls, and it ends up in logs and in the audit trail.
// Only a short, plain value is accepted; anything else is replaced by a generated one.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

export function generateRequestId(request: IncomingMessage) {
  const header = request.headers['x-request-id']

  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : randomUUID()
}
