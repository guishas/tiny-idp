import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  ISSUER: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

const parsed = envSchema.parse(process.env)

export const env = {
  ...parsed,
  // Public base URL of this server. Used as the OIDC issuer from milestone 3 on (no trailing slash).
  ISSUER: (parsed.ISSUER ?? `http://localhost:${parsed.PORT}`).replace(/\/$/, ''),
}
