// MARCO 4 — organizações, papéis customizados, can() e delegação. Autenticação: cookie de sessão (marco 1).
//
// Catálogo FIXO de permissões:
//   invoice:create  invoice:read  invoice:read:own  invoice:approve
//   role:manage  member:manage  delegation:manage  audit:read
//
// Contrato:
//   POST /orgs {name}                        -> 201 {id, name}. Quem cria vira membro com o papel embutido "owner" (todas as permissões)
//   GET  /orgs/:orgId                        -> 200 {id, name} para membros | 404 para quem não é membro (não vaza a existência)
//   POST /orgs/:orgId/roles {name, permissions[]}
//                                            -> 201 {id, name, permissions} | 400 permissão desconhecida | 403 sem role:manage
//                                               ou tentando dar uma permissão que você mesmo não tem (anti-escalonamento)
//   POST /orgs/:orgId/members {email, roleId} -> 201 | 404 usuário inexistente | 400 role de outra org | 409 já é membro
//                                               | 403 sem member:manage OU papel com permissões que você não tem
//   PUT  /orgs/:orgId/members/:userId {roleId} -> 200 (mesmas regras)
//   POST /orgs/:orgId/invoices {amount}      -> 201 {id, amount, ownerId} (amount: inteiro positivo, em centavos) | 403 sem invoice:create
//   GET  /orgs/:orgId/invoices               -> 200 [...]  com invoice:read vê TODAS; só com invoice:read:own vê as SUAS; nenhuma -> 403
//   GET  /orgs/:orgId/invoices/:id           -> 200 | 404 se não existe, é de outra org, ou é de outra pessoa e você só tem read:own
//   POST /orgs/:orgId/invoices/:id/approve   -> 200 {id, status:"approved"} | 403 sem invoice:approve
//   POST /orgs/:orgId/delegations {toEmail, permissions[], expiresInSeconds}
//                                            -> 201 {id} | 403 delegando permissão que você não tem | 400 expiresInSeconds fora de 1..604800
//                                               | 404 destinatário não é membro da org
//   DELETE /orgs/:orgId/delegations/:id      -> 204 (delegante ou quem tem delegation:manage) | 403 | 404
//
// Regra do can(): NEGAR POR PADRÃO. Permissão vem do papel OU de uma delegação ativa (não expirada, não revogada)
// cujo delegante AINDA possui aquela permissão pelo papel dele. Delegação não encadeia (quem recebeu não delega).
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { bonus, type Json, makeUser, type Res, rnd, sleep } from './helpers'

/** Cria uma org com um dono e devolve utilitários. */
async function setupOrg() {
  const owner = await makeUser('owner')
  const org = await owner.s.post('/orgs', { name: `Org ${rnd()}` })
  assert.equal(org.status, 201, org.text)
  const orgId = org.json.id

  const role = async (permissions: string[], name = `role-${rnd(3)}`) => {
    const r = await owner.s.post(`/orgs/${orgId}/roles`, { name, permissions })
    assert.equal(r.status, 201, `criar role: ${r.text}`)
    return r.json.id
  }
  const addMember = async (roleId: string, prefix = 'member') => {
    const u = await makeUser(prefix)
    const r = await owner.s.post(`/orgs/${orgId}/members`, { email: u.email, roleId })
    assert.equal(r.status, 201, `adicionar membro: ${r.text}`)
    return u
  }
  const invoice = async (amount = 5000, as = owner) => {
    const r = await as.s.post(`/orgs/${orgId}/invoices`, { amount })
    assert.equal(r.status, 201, `criar invoice: ${r.text}`)
    return r.json
  }
  return { owner, orgId, role, addMember, invoice }
}

test('org: quem cria vira owner; não-membro recebe 404', async () => {
  const { owner, orgId } = await setupOrg()
  assert.equal((await owner.s.get(`/orgs/${orgId}`)).status, 200)
  const stranger = await makeUser('stranger')
  assert.equal((await stranger.s.get(`/orgs/${orgId}`)).status, 404)
  const anon = await makeUser('anon')
  anon.s.cookies.clear()
  assert.equal((await anon.s.get(`/orgs/${orgId}`)).status, 401)
})

test('roles: permissão desconhecida -> 400', async () => {
  const { owner, orgId } = await setupOrg()
  const r = await owner.s.post(`/orgs/${orgId}/roles`, { name: 'x', permissions: ['invoice:fly'] })
  assert.equal(r.status, 400)
})

test('roles: exige role:manage (negar por padrão)', async () => {
  const { orgId, role, addMember } = await setupOrg()
  const empty = await role([])
  const nobody = await addMember(empty)
  const r = await nobody.s.post(`/orgs/${orgId}/roles`, { name: 'tentativa', permissions: [] })
  assert.equal(r.status, 403)
})

test('roles: anti-escalonamento — não dá para criar papel com permissão que você não tem', async () => {
  const { orgId, role, addMember } = await setupOrg()
  const roleManager = await role(['role:manage'])
  const mgr = await addMember(roleManager)
  const ok = await mgr.s.post(`/orgs/${orgId}/roles`, { name: 'ok', permissions: ['role:manage'] })
  assert.equal(ok.status, 201, ok.text)
  const escalate = await mgr.s.post(`/orgs/${orgId}/roles`, {
    name: 'esc',
    permissions: ['invoice:approve'],
  })
  assert.equal(escalate.status, 403)
})

test('members: 404 usuário inexistente, 400 role de outra org, 409 duplicado', async () => {
  const { owner, orgId, role } = await setupOrg()
  const roleId = await role([])
  const ghost = await owner.s.post(`/orgs/${orgId}/members`, {
    email: `ghost-${rnd()}@example.test`,
    roleId,
  })
  assert.equal(ghost.status, 404)

  const other = await setupOrg()
  const foreignRole = await other.role([])
  const u = await makeUser('m4')
  const wrongOrgRole = await owner.s.post(`/orgs/${orgId}/members`, {
    email: u.email,
    roleId: foreignRole,
  })
  assert.equal(wrongOrgRole.status, 400)

  assert.equal(
    (await owner.s.post(`/orgs/${orgId}/members`, { email: u.email, roleId })).status,
    201,
  )
  assert.equal(
    (await owner.s.post(`/orgs/${orgId}/members`, { email: u.email, roleId })).status,
    409,
  )
})

test('members: não dá para atribuir um papel mais poderoso que o seu', async () => {
  const { orgId, role, addMember } = await setupOrg()
  const memberManager = await role(['member:manage'])
  const strong = await role(['invoice:approve'])
  const mgr = await addMember(memberManager)
  const target = await makeUser('target')
  const r = await mgr.s.post(`/orgs/${orgId}/members`, { email: target.email, roleId: strong })
  assert.equal(r.status, 403)
})

test('invoices: criar exige invoice:create e valida amount', async () => {
  const { owner, orgId, role, addMember } = await setupOrg()
  const viewer = await addMember(await role(['invoice:read']))
  assert.equal((await viewer.s.post(`/orgs/${orgId}/invoices`, { amount: 100 })).status, 403)
  assert.equal((await owner.s.post(`/orgs/${orgId}/invoices`, { amount: -5 })).status, 400)
  assert.equal((await owner.s.post(`/orgs/${orgId}/invoices`, { amount: 1.5 })).status, 400)
  const ok = await owner.s.post(`/orgs/${orgId}/invoices`, { amount: 100 })
  assert.equal(ok.status, 201)
  assert.equal(ok.json.ownerId, owner.id)
})

test('invoices: listagem filtrada — read vê tudo, read:own vê só as suas, sem nenhuma -> 403', async () => {
  const { owner, orgId, role, addMember, invoice } = await setupOrg()
  const creatorRole = await role(['invoice:create', 'invoice:read:own'])
  const alice = await addMember(creatorRole, 'alice')
  const bob = await addMember(creatorRole, 'bob')
  const reader = await addMember(await role(['invoice:read']), 'reader')
  const nobody = await addMember(await role([]), 'nobody')

  const inv1 = await invoice(1000, alice)
  const inv2 = await invoice(2000, bob)
  const inv3 = await invoice(3000, owner)

  const ids = (r: Res) => r.json.map((i: Json) => i.id).sort()
  const aliceList = await alice.s.get(`/orgs/${orgId}/invoices`)
  assert.equal(aliceList.status, 200)
  assert.deepEqual(ids(aliceList), [inv1.id])

  const readerList = await reader.s.get(`/orgs/${orgId}/invoices`)
  assert.deepEqual(ids(readerList), [inv1.id, inv2.id, inv3.id].sort())

  assert.equal((await nobody.s.get(`/orgs/${orgId}/invoices`)).status, 403)

  // detalhe: invoice alheia para quem só tem read:own -> 404 (não vaza existência)
  assert.equal((await alice.s.get(`/orgs/${orgId}/invoices/${inv2.id}`)).status, 404)
  assert.equal((await alice.s.get(`/orgs/${orgId}/invoices/${inv1.id}`)).status, 200)
})

test('invoices: isolamento entre organizações (404)', async () => {
  const a = await setupOrg()
  const b = await setupOrg()
  const inv = await a.invoice(1234)
  // dono da org B tenta ler a invoice da org A, usando a org A e usando a org B
  assert.equal((await b.owner.s.get(`/orgs/${a.orgId}/invoices/${inv.id}`)).status, 404)
  assert.equal((await b.owner.s.get(`/orgs/${b.orgId}/invoices/${inv.id}`)).status, 404)
  assert.equal(
    (await b.owner.s.post(`/orgs/${a.orgId}/invoices/${inv.id}/approve`, {})).status,
    404,
  )
})

test('approve: exige invoice:approve', async () => {
  const { orgId, role, addMember, invoice, owner } = await setupOrg()
  const inv = await invoice(5000)
  const weak = await addMember(await role(['invoice:read']))
  assert.equal((await weak.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})).status, 403)
  const approver = await addMember(await role(['invoice:approve']))
  const r = await approver.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.status, 'approved')
  assert.ok(owner)
})

test('delegação: concede só o que foi delegado', async () => {
  const { orgId, role, addMember, invoice } = await setupOrg()
  const inv = await invoice(5000)
  const approver = await addMember(await role(['invoice:approve']), 'approver')
  const accountant = await addMember(await role([]), 'accountant')

  assert.equal(
    (await accountant.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})).status,
    403,
  )

  const d = await approver.s.post(`/orgs/${orgId}/delegations`, {
    toEmail: accountant.email,
    permissions: ['invoice:approve'],
    expiresInSeconds: 3600,
  })
  assert.equal(d.status, 201, d.text)
  const ok = await accountant.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})
  assert.equal(ok.status, 200, ok.text)

  // delegação de aprovar não dá o direito de criar invoices
  assert.equal((await accountant.s.post(`/orgs/${orgId}/invoices`, { amount: 1 })).status, 403)
})

test('delegação: não dá para delegar o que você não tem; validação de prazo e destinatário', async () => {
  const { orgId, role, addMember } = await setupOrg()
  const weak = await addMember(await role(['invoice:read']), 'weak')
  const target = await addMember(await role([]), 'target')
  const base = { toEmail: target.email, permissions: ['invoice:approve'], expiresInSeconds: 60 }

  assert.equal((await weak.s.post(`/orgs/${orgId}/delegations`, base)).status, 403)
  assert.equal(
    (
      await weak.s.post(`/orgs/${orgId}/delegations`, {
        ...base,
        permissions: ['invoice:read'],
        expiresInSeconds: 0,
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await weak.s.post(`/orgs/${orgId}/delegations`, {
        ...base,
        permissions: ['invoice:read'],
        expiresInSeconds: 999999999,
      })
    ).status,
    400,
  )
  const outsider = await makeUser('outsider')
  assert.equal(
    (
      await weak.s.post(`/orgs/${orgId}/delegations`, {
        ...base,
        toEmail: outsider.email,
        permissions: ['invoice:read'],
      })
    ).status,
    404,
  )
})

test('delegação: expira sozinha', async () => {
  const { orgId, role, addMember, invoice } = await setupOrg()
  const inv = await invoice(5000)
  const approver = await addMember(await role(['invoice:approve']), 'approver')
  const accountant = await addMember(await role([]), 'accountant')
  const d = await approver.s.post(`/orgs/${orgId}/delegations`, {
    toEmail: accountant.email,
    permissions: ['invoice:approve'],
    expiresInSeconds: 1,
  })
  assert.equal(d.status, 201)
  await sleep(1600)
  assert.equal(
    (await accountant.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})).status,
    403,
  )
})

test('delegação: pode ser revogada pelo delegante, e só por quem pode', async () => {
  const { orgId, role, addMember, invoice } = await setupOrg()
  const inv = await invoice(5000)
  const approver = await addMember(await role(['invoice:approve']), 'approver')
  const accountant = await addMember(await role([]), 'accountant')
  const d = await approver.s.post(`/orgs/${orgId}/delegations`, {
    toEmail: accountant.email,
    permissions: ['invoice:approve'],
    expiresInSeconds: 3600,
  })
  assert.equal((await accountant.s.del(`/orgs/${orgId}/delegations/${d.json.id}`)).status, 403)
  assert.equal((await approver.s.del(`/orgs/${orgId}/delegations/${d.json.id}`)).status, 204)
  assert.equal(
    (await accountant.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})).status,
    403,
  )
})

test('delegação: se o delegante perde a permissão, a delegação para de valer', async () => {
  const { owner, orgId, role, addMember, invoice } = await setupOrg()
  const inv = await invoice(5000)
  const approverRole = await role(['invoice:approve'])
  const emptyRole = await role([])
  const approver = await addMember(approverRole, 'approver')
  const accountant = await addMember(emptyRole, 'accountant')
  await approver.s.post(`/orgs/${orgId}/delegations`, {
    toEmail: accountant.email,
    permissions: ['invoice:approve'],
    expiresInSeconds: 3600,
  })
  const demote = await owner.s.put(`/orgs/${orgId}/members/${approver.id}`, { roleId: emptyRole })
  assert.equal(demote.status, 200, demote.text)
  assert.equal(
    (await accountant.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})).status,
    403,
  )
})

bonus('delegação não encadeia: quem recebeu não pode delegar de novo', async () => {
  const { orgId, role, addMember } = await setupOrg()
  const approver = await addMember(await role(['invoice:approve']), 'approver')
  const middle = await addMember(await role([]), 'middle')
  const last = await addMember(await role([]), 'last')
  await approver.s.post(`/orgs/${orgId}/delegations`, {
    toEmail: middle.email,
    permissions: ['invoice:approve'],
    expiresInSeconds: 3600,
  })
  const chain = await middle.s.post(`/orgs/${orgId}/delegations`, {
    toEmail: last.email,
    permissions: ['invoice:approve'],
    expiresInSeconds: 3600,
  })
  assert.equal(chain.status, 403)
})
