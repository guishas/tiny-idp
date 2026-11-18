import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { can } from '@/authz/can'
import { HttpError } from '@/http/http-error'
import { authorize, getOrg } from '@/http/org-context'
import { parseBody } from '@/http/validate'
import type { Invoice } from '@/store'

// Whole cents, never fractions: money stays out of floating point.
const createInvoiceSchema = z.object({ amount: z.number().int().positive() })
const invoiceParamsSchema = z.object({ id: z.string() })

const toPublicInvoice = (invoice: Invoice) => ({
  id: invoice.id,
  amount: invoice.amount,
  ownerId: invoice.ownerId,
  status: invoice.status,
})

export async function invoiceRoutes(app: FastifyInstance) {
  app.post('/orgs/:orgId/invoices', async (request, reply) => {
    const { user, org } = getOrg(request)

    authorize(org, user.id, 'invoice:create')
    const { amount } = parseBody(createInvoiceSchema, request.body)

    const invoice: Invoice = { id: randomUUID(), amount, ownerId: user.id, status: 'pending' }
    org.invoices.set(invoice.id, invoice)

    return reply.code(201).send(toPublicInvoice(invoice))
  })

  // Authorization for a list is part of the query, not a check per row: with only read:own the
  // filter by owner happens on the server, before anything is returned.
  app.get('/orgs/:orgId/invoices', async (request) => {
    const { user, org } = getOrg(request)

    const invoices = [...org.invoices.values()]

    if (can(org, user.id, 'invoice:read').allowed) return invoices.map(toPublicInvoice)

    authorize(org, user.id, 'invoice:read:own')

    return invoices.filter((invoice) => invoice.ownerId === user.id).map(toPublicInvoice)
  })

  app.get('/orgs/:orgId/invoices/:id', async (request) => {
    const { user, org } = getOrg(request)
    const { id } = parseBody(invoiceParamsSchema, request.params)

    const readsAll = can(org, user.id, 'invoice:read').allowed
    if (!readsAll) authorize(org, user.id, 'invoice:read:own')

    // IDOR defense: the lookup is scoped to the org of the URL, so an id from another tenant is
    // simply not found. Someone else's invoice answers 404, the same as a missing one, so the
    // response never confirms that it exists.
    const invoice = org.invoices.get(id)
    if (!invoice || (!readsAll && invoice.ownerId !== user.id)) {
      throw new HttpError(404, 'not_found')
    }

    return toPublicInvoice(invoice)
  })

  app.post('/orgs/:orgId/invoices/:id/approve', async (request) => {
    const { user, org } = getOrg(request)
    const { id } = parseBody(invoiceParamsSchema, request.params)

    authorize(org, user.id, 'invoice:approve')

    const invoice = org.invoices.get(id)
    if (!invoice) throw new HttpError(404, 'not_found')

    // Approving twice is harmless, and the first approver stays on record.
    if (invoice.status !== 'approved') {
      invoice.status = 'approved'
      invoice.approvedBy = user.id
    }

    return { id: invoice.id, status: invoice.status }
  })
}
