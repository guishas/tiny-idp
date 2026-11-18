import { z } from 'zod'

// Emails are case-insensitive in practice, so "Ana@X.com" and "ana@x.com" must be the same
// account. Normalizing before validating and storing guarantees that.
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())
