import type { z } from 'zod'

import { HttpError } from '@/http/http-error'

// Nothing from the request is trusted until it passes through a schema.
// The validation details are deliberately not sent back: the client only learns "bad request".
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw new HttpError(400, 'invalid_request')

  return result.data
}
