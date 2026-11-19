// An error that is safe to show to the client: a status code plus a short, stable machine code.
// Anything that is NOT an HttpError is treated as a bug and answered with a generic 500.
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
    // Extra fixed fields for the JSON body, next to `error` (used by the RFC 9470 challenge).
    readonly details: Record<string, unknown> = {},
  ) {
    super(code)
    this.name = 'HttpError'
  }
}
