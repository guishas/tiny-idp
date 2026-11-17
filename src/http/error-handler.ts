import type { FastifyReply, FastifyRequest } from 'fastify'

import { HttpError } from '@/http/http-error'

// Errors raised by Fastify itself (malformed JSON, unsupported content type, payload too large...)
// carry a 4xx `statusCode`. They are the client's fault, so the status must be preserved.
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined

  const { statusCode } = error
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined
}

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).headers(error.headers).send({ error: error.code })
  }

  const status = clientErrorStatus(error)
  if (status) {
    return reply.code(status).send({ error: 'invalid_request' })
  }

  // A real bug. The detail goes to the log only: the client must learn nothing about internals.
  request.log.error(error)
  return reply.code(500).send({ error: 'server_error' })
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({ error: 'not_found' })
}
