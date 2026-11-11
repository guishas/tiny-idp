// MARCO 5 — MFA com TOTP, step-up (RFC 9470) e audit log. (Passkeys: ver o guia; a parte de WebAuthn é manual.)
//
// Contrato:
//   GET  /me                      -> agora também devolve  acr: "pwd" | "mfa"  e  auth_time (segundos Unix)
//   POST /mfa/totp/enroll         -> 200 {secret (base32), otpauth_uri ("otpauth://totp/...")}   (precisa de sessão)
//   POST /mfa/totp/confirm {code} -> 204 ativa o MFA | 400 código errado
//   POST /stepup {code}           -> 204: a sessão passa a acr:"mfa" e auth_time=agora | 401 código errado | 409 MFA não ativado
//        (aceite códigos da janela atual e de ±1 janela de 30 s)
//   POST /orgs/:o/invoices/:i/approve  com amount >= 100000 (R$ 1.000,00) exige sessão acr:"mfa" com auth_time <= 300 s:
//        senão 401 com  WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values="mfa", max_age="300"
//        e corpo {error:"insufficient_user_authentication", acr_values:"mfa", max_age:300}
//        (a checagem de permissão vem ANTES: sem invoice:approve é 403, nunca 401)
//   GET  /orgs/:o/audit?limit=N   -> 200 [eventos] do mais novo para o mais antigo; exige audit:read (senão 403)
//        evento: {id, ts (ISO 8601), actor, subject, on_behalf_of, action, resource, outcome, request_id}
//        actions: role.created | member.added | delegation.created | delegation.revoked | invoice.created | invoice.approve
//        outcome: success | denied | step_up_required
//        on_behalf_of = id do delegante quando a ação só foi permitida por uma delegação
//        request_id = header X-Request-Id da requisição (se vier), senão gerado; também devolvido no header X-Request-Id
//   Audit é APPEND-ONLY: não existe PUT/PATCH/DELETE em /audit
//   POST /webauthn/register/options (bônus) -> 200 {challenge, rp:{id,name}, user:{id,name}} com challenge novo a cada chamada

import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { bonus, type Json, makeUser, PASSWORD, relogin, rnd, type TestUser, totp } from './helpers'

const BIG = 150000 // >= 100000 exige step-up
const SMALL = 5000

async function enrollMfa(user: TestUser) {
  const e = await user.s.post('/mfa/totp/enroll', {})
  assert.equal(e.status, 200, e.text)
  assert.match(e.json.otpauth_uri, /^otpauth:\/\/totp\//)
  const c = await user.s.post('/mfa/totp/confirm', { code: totp(e.json.secret) })
  assert.equal(c.status, 204, c.text)
  return e.json.secret
}

async function setup() {
  const owner = await makeUser('owner')
  const org = await owner.s.post('/orgs', { name: `Org ${rnd()}` })
  const orgId = org.json.id
  const mk = async (amount: number) =>
    (await owner.s.post(`/orgs/${orgId}/invoices`, { amount })).json
  return { owner, orgId, mk }
}

test('/me mostra acr "pwd" e auth_time depois do login com senha', async () => {
  const u = await makeUser('m5')
  const me = await u.s.get('/me')
  assert.equal(me.json.acr, 'pwd')
  const now = Math.floor(Date.now() / 1000)
  assert.ok(Math.abs(me.json.auth_time - now) <= 10, 'auth_time deve ser ~agora (segundos Unix)')
})

test('totp: confirmar com código errado -> 400; certo -> 204', async () => {
  const u = await makeUser('m5')
  const e = await u.s.post('/mfa/totp/enroll', {})
  assert.equal(e.status, 200, e.text)
  assert.match(e.json.secret, /^[A-Z2-7]+=*$/, 'secret em base32')
  const wrong = await u.s.post('/mfa/totp/confirm', {
    code: '000000' === totp(e.json.secret) ? '111111' : '000000',
  })
  assert.equal(wrong.status, 400)
  assert.equal((await u.s.post('/mfa/totp/confirm', { code: totp(e.json.secret) })).status, 204)
})

test('stepup: sem MFA ativado -> 409; código errado -> 401; certo -> 204 e acr "mfa"', async () => {
  const u = await makeUser('m5')
  assert.equal((await u.s.post('/stepup', { code: '123456' })).status, 409)
  const secret = await enrollMfa(u)
  const wrongCode = totp(secret, 0) === '999999' ? '888888' : '999999'
  assert.equal((await u.s.post('/stepup', { code: wrongCode })).status, 401)
  assert.equal((await u.s.post('/stepup', { code: totp(secret, 0) })).status, 204)
  const me = await u.s.get('/me')
  assert.equal(me.json.acr, 'mfa')
})

test('step-up: aprovar invoice grande com login só de senha -> 401 com o desafio do RFC 9470', async () => {
  const { owner, orgId, mk } = await setup()
  await enrollMfa(owner)
  const big = await mk(BIG)
  const r = await owner.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {})
  assert.equal(r.status, 401, r.text)
  const h = r.headers.get('www-authenticate') ?? ''
  assert.match(h, /insufficient_user_authentication/)
  assert.match(h, /acr_values="?mfa"?/)
  assert.match(h, /max_age="?300"?/)
  assert.equal(r.json?.error, 'insufficient_user_authentication')
})

test('step-up: depois do /stepup a aprovação passa; invoice pequena nunca pede MFA', async () => {
  const { owner, orgId, mk } = await setup()
  const secret = await enrollMfa(owner)
  const small = await mk(SMALL)
  const big = await mk(BIG)
  const smallOk = await owner.s.post(`/orgs/${orgId}/invoices/${small.id}/approve`, {})
  assert.equal(smallOk.status, 200, smallOk.text)

  assert.equal((await owner.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {})).status, 401)
  assert.equal((await owner.s.post('/stepup', { code: totp(secret, 0) })).status, 204)
  const ok = await owner.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {})
  assert.equal(ok.status, 200, ok.text)
})

test('step-up: um novo login volta para acr "pwd" e pede MFA de novo', async () => {
  const { owner, orgId, mk } = await setup()
  const secret = await enrollMfa(owner)
  await owner.s.post('/stepup', { code: totp(secret, 0) })
  const fresh = await relogin(owner)
  assert.equal((await fresh.s.get('/me')).json.acr, 'pwd')
  const big = await mk(BIG)
  assert.equal((await fresh.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {})).status, 401)
  // usa a janela +1 para não colidir com o código já usado
  assert.equal((await fresh.s.post('/stepup', { code: totp(secret, 1) })).status, 204)
  assert.equal((await fresh.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {})).status, 200)
})

test('step-up: sem permissão a resposta é 403, nunca 401 (permissão vem antes)', async () => {
  const { owner, orgId, mk } = await setup()
  const role = await owner.s.post(`/orgs/${orgId}/roles`, { name: `r-${rnd(3)}`, permissions: [] })
  const weak = await makeUser('weak')
  await owner.s.post(`/orgs/${orgId}/members`, { email: weak.email, roleId: role.json.id })
  const big = await mk(BIG)
  assert.equal((await weak.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {})).status, 403)
})

test('audit: registra quem fez o quê, com request_id, e devolve o mais novo primeiro', async () => {
  const { owner, orgId, mk } = await setup()
  const inv = await mk(SMALL)
  const requestId = `req-${rnd()}`
  const r = await owner.s.post(
    `/orgs/${orgId}/invoices/${inv.id}/approve`,
    {},
    { headers: { 'x-request-id': requestId } },
  )
  assert.equal(r.status, 200)
  assert.equal(
    r.headers.get('x-request-id'),
    requestId,
    'devolva o X-Request-Id no header da resposta',
  )

  const a = await owner.s.get(`/orgs/${orgId}/audit?limit=50`)
  assert.equal(a.status, 200, a.text)
  assert.ok(Array.isArray(a.json) && a.json.length >= 2)
  const ev = a.json.find(
    (e: Json) => e.action === 'invoice.approve' && e.resource?.includes(inv.id),
  )
  assert.ok(ev, 'faltou o evento invoice.approve')
  assert.equal(ev.actor, owner.id)
  assert.equal(ev.outcome, 'success')
  assert.equal(ev.request_id, requestId)
  assert.ok(!Number.isNaN(Date.parse(ev.ts)), 'ts em ISO 8601')
  assert.ok(a.json.some((e: Json) => e.action === 'invoice.created'))

  const times = a.json.map((e: Json) => Date.parse(e.ts))
  assert.deepEqual(
    [...times].sort((x, y) => y - x),
    times,
    'mais novo primeiro',
  )
  const one = await owner.s.get(`/orgs/${orgId}/audit?limit=1`)
  assert.equal(one.json.length, 1)
})

test('audit: negativas e desafios de step-up também são registrados', async () => {
  const { owner, orgId, mk } = await setup()
  await enrollMfa(owner)
  const big = await mk(BIG)
  await owner.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {}) // 401 step-up
  const role = await owner.s.post(`/orgs/${orgId}/roles`, { name: `r-${rnd(3)}`, permissions: [] })
  const weak = await makeUser('weak')
  await owner.s.post(`/orgs/${orgId}/members`, { email: weak.email, roleId: role.json.id })
  await weak.s.post(`/orgs/${orgId}/invoices/${big.id}/approve`, {}) // 403

  const a = await owner.s.get(`/orgs/${orgId}/audit?limit=100`)
  const outcomes = a.json
    .filter((e: Json) => e.action === 'invoice.approve')
    .map((e: Json) => `${e.actor}:${e.outcome}`)
  assert.ok(outcomes.includes(`${owner.id}:step_up_required`), outcomes.join(' | '))
  assert.ok(outcomes.includes(`${weak.id}:denied`), outcomes.join(' | '))
  assert.ok(a.json.some((e: Json) => e.action === 'role.created'))
  assert.ok(a.json.some((e: Json) => e.action === 'member.added' && e.subject === weak.id))
})

test('audit: ações feitas por delegação registram on_behalf_of', async () => {
  const { owner, orgId, mk } = await setup()
  const mkRole = async (permissions: string[]) =>
    (await owner.s.post(`/orgs/${orgId}/roles`, { name: `r-${rnd(3)}`, permissions })).json.id
  const approver = await makeUser('approver')
  const accountant = await makeUser('accountant')
  await owner.s.post(`/orgs/${orgId}/members`, {
    email: approver.email,
    roleId: await mkRole(['invoice:approve']),
  })
  await owner.s.post(`/orgs/${orgId}/members`, {
    email: accountant.email,
    roleId: await mkRole([]),
  })
  const inv = await mk(SMALL)

  const d = await approver.s.post(`/orgs/${orgId}/delegations`, {
    toEmail: accountant.email,
    permissions: ['invoice:approve'],
    expiresInSeconds: 3600,
  })
  assert.equal(d.status, 201)
  assert.equal(
    (await accountant.s.post(`/orgs/${orgId}/invoices/${inv.id}/approve`, {})).status,
    200,
  )
  assert.equal((await approver.s.del(`/orgs/${orgId}/delegations/${d.json.id}`)).status, 204)

  const a = await owner.s.get(`/orgs/${orgId}/audit?limit=100`)
  const approve = a.json.find(
    (e: Json) => e.action === 'invoice.approve' && e.actor === accountant.id,
  )
  assert.ok(approve, 'faltou o evento de aprovação do contador')
  assert.equal(approve.on_behalf_of, approver.id)
  assert.ok(
    a.json.some(
      (e: Json) =>
        e.action === 'delegation.created' && e.actor === approver.id && e.subject === accountant.id,
    ),
  )
  assert.ok(a.json.some((e: Json) => e.action === 'delegation.revoked'))
})

test('audit: exige audit:read e nunca contém segredos', async () => {
  const { owner, orgId, mk } = await setup()
  const secret = await enrollMfa(owner)
  await mk(SMALL)
  const role = await owner.s.post(`/orgs/${orgId}/roles`, {
    name: `r-${rnd(3)}`,
    permissions: ['invoice:read'],
  })
  const reader = await makeUser('reader')
  await owner.s.post(`/orgs/${orgId}/members`, { email: reader.email, roleId: role.json.id })
  assert.equal((await reader.s.get(`/orgs/${orgId}/audit`)).status, 403)

  const a = await owner.s.get(`/orgs/${orgId}/audit?limit=200`)
  assert.ok(!a.text.includes(PASSWORD), 'senha no audit!')
  assert.ok(!a.text.includes(secret), 'segredo do TOTP no audit!')
  assert.ok(!/sid=|bearer /i.test(a.text), 'cookie/token no audit!')
  const sidValue = owner.s.cookies.get('sid')
  assert.ok(sidValue && !a.text.includes(sidValue), 'id de sessão no audit!')
})

test('audit: é append-only (sem PUT/PATCH/DELETE)', async () => {
  const { owner, orgId } = await setup()
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const r = await owner.s.req(method, `/orgs/${orgId}/audit`, { json: {} })
    assert.ok(
      [404, 405].includes(r.status),
      `${method} /audit deveria ser 404/405, veio ${r.status}`,
    )
  }
})

bonus('totp: o mesmo código não pode ser usado duas vezes no /stepup (anti-replay)', async () => {
  const u = await makeUser('m5')
  const secret = await enrollMfa(u)
  const code = totp(secret, 0)
  assert.equal((await u.s.post('/stepup', { code })).status, 204)
  assert.equal((await u.s.post('/stepup', { code })).status, 401)
})

bonus('passkeys: /webauthn/register/options devolve um challenge novo a cada chamada', async () => {
  const u = await makeUser('m5')
  const a = await u.s.post('/webauthn/register/options', {})
  const b = await u.s.post('/webauthn/register/options', {})
  assert.equal(a.status, 200, a.text)
  assert.ok(a.json.challenge && a.json.challenge.length >= 16)
  assert.ok(a.json.rp?.id && a.json.user?.id)
  assert.notEqual(a.json.challenge, b.json.challenge)
})
