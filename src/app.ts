import fastify from 'fastify'

export const app = fastify()

// Liveness probe. Everything else is built milestone by milestone: see the README.
app.get('/health', async () => ({ status: 'ok' }))
