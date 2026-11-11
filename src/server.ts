import { app } from '@/app'
import { env } from '@/env'

await app.listen({ port: env.PORT, host: '0.0.0.0' })
console.log(`tiny-idp listening on ${env.ISSUER}`)
