// MARCO 3 — OpenID Connect em cima do seu servidor OAuth.
//
// Contrato:
//   GET /.well-known/openid-configuration -> 200 JSON com: issuer, authorization_endpoint, token_endpoint,
//        userinfo_endpoint, jwks_uri, response_types_supported (inclui "code"), scopes_supported (inclui "openid"),
//        subject_types_supported, id_token_signing_alg_values_supported (RS256 ou ES256; NUNCA "none"),
//        code_challenge_methods_supported (inclui "S256")
//   GET /jwks.json (ou o caminho que o seu discovery indicar em jwks_uri)
//        -> {keys:[{kty, kid, alg, use:"sig", ...só a parte pública}]}
//   POST /token com scope "openid" -> resposta inclui id_token (JWT assinado, RS256 ou ES256) com
//        iss, sub, aud (= client_id), exp, iat e nonce (se enviado no /authorize)
//   GET /userinfo (Bearer) -> 200 {sub, email} (email só com escopo "email"); exige escopo "openid"
//
// Sem o escopo "openid" NÃO deve haver id_token.
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import {
  BASE,
  CLIENT_ID,
  Session,
  bonus,
  decodeJwt,
  getTokens,
  makeUser,
  relogin,
  rnd,
  verifyJwtSignature,
  type Json,
} from './helpers'

async function discovery() {
  const r = await new Session().get('/.well-known/openid-configuration')
  assert.equal(r.status, 200, 'discovery precisa responder 200')
  assert.ok(r.json, 'discovery precisa ser JSON')
  return r.json
}

async function jwks(doc: Json) {
  const url = new URL(doc.jwks_uri, BASE)
  const res = await fetch(url)
  assert.equal(res.status, 200, `jwks_uri (${url}) deveria dar 200`)
  return res.json()
}

test('discovery: campos obrigatórios e valores coerentes', async () => {
  const d = await discovery()
  for (const f of [
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'userinfo_endpoint',
    'jwks_uri',
  ]) {
    assert.equal(typeof d[f], 'string', `faltou o campo ${f}`)
  }
  assert.ok(d.response_types_supported?.includes('code'))
  assert.ok(d.scopes_supported?.includes('openid'))
  assert.ok(Array.isArray(d.subject_types_supported) && d.subject_types_supported.length > 0)
  assert.ok(d.code_challenge_methods_supported?.includes('S256'))
  const algs = d.id_token_signing_alg_values_supported
  assert.ok(
    algs?.some((a: string) => a === 'RS256' || a === 'ES256'),
    'liste RS256 ou ES256',
  )
  assert.ok(!algs.includes('none'), '"none" nunca pode estar na lista')
  assert.ok(!d.issuer.endsWith('/'), 'issuer sem barra final (evita erro de comparação)')
})

test('jwks: tem kid, alg e use, e NUNCA expõe a parte privada da chave', async () => {
  const set = await jwks(await discovery())
  assert.ok(Array.isArray(set.keys) && set.keys.length > 0)
  for (const k of set.keys) {
    assert.ok(k.kid, 'toda chave precisa de kid')
    assert.ok(k.kty, 'toda chave precisa de kty')
    assert.ok(['RS256', 'ES256'].includes(k.alg), `alg deve ser RS256 ou ES256, veio ${k.alg}`)
    assert.equal(k.use, 'sig')
    for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      assert.equal(k[priv], undefined, `NUNCA publique o campo privado "${priv}"`)
    }
  }
})

test('id_token: assinatura válida e claims corretas', async () => {
  const d = await discovery()
  const set = await jwks(d)
  const u = await makeUser('m3')
  const nonce = rnd(8)
  const before = Math.floor(Date.now() / 1000)
  const { tokens } = await getTokens(u.s, { scope: 'openid email', nonce })
  assert.ok(tokens.id_token, 'com escopo openid a resposta precisa ter id_token')

  const { header, payload } = decodeJwt(tokens.id_token)
  assert.ok(['RS256', 'ES256'].includes(header.alg), `alg inesperado: ${header.alg}`)
  assert.ok(header.kid, 'header sem kid')
  assert.ok(
    verifyJwtSignature(tokens.id_token, set),
    'assinatura não confere com as chaves do JWKS',
  )

  assert.equal(payload.iss, d.issuer, 'iss deve ser igual ao issuer do discovery')
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  assert.ok(aud.includes(CLIENT_ID), 'aud deve conter o client_id')
  assert.ok(typeof payload.sub === 'string' && payload.sub.length > 0)
  assert.ok(payload.exp > before, 'exp deve estar no futuro')
  assert.ok(payload.exp - payload.iat <= 3600, 'ID token de vida curta (<= 1h)')
  assert.ok(payload.iat <= Math.floor(Date.now() / 1000) + 5, 'iat não pode estar no futuro')
  assert.equal(payload.nonce, nonce, 'nonce do /authorize deve voltar no id_token')
})

test('id_token: não aparece sem o escopo openid', async () => {
  const u = await makeUser('m3')
  const { tokens } = await getTokens(u.s, { scope: 'profile' })
  assert.equal(tokens.id_token, undefined)
})

test('sub é estável entre logins e não é o email', async () => {
  const u = await makeUser('m3')
  const a = await getTokens(u.s, { scope: 'openid' })
  const again = await relogin(u)
  const b = await getTokens(again.s, { scope: 'openid' })
  const subA = decodeJwt(a.tokens.id_token).payload.sub
  const subB = decodeJwt(b.tokens.id_token).payload.sub
  assert.equal(subA, subB, 'sub precisa ser o mesmo para o mesmo usuário')
  assert.notEqual(subA, u.email, 'não use o email como sub')
})

test('/userinfo: exige Bearer com escopo openid e devolve sub igual ao do id_token', async () => {
  const u = await makeUser('m3')
  assert.equal((await new Session().get('/userinfo')).status, 401)

  const { tokens } = await getTokens(u.s, { scope: 'openid email' })
  const r = await new Session().get('/userinfo', { bearer: tokens.access_token })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.sub, decodeJwt(tokens.id_token).payload.sub)
  assert.equal(r.json.email, u.email)

  const noOpenid = await getTokens(u.s, { scope: 'profile' })
  const denied = await new Session().get('/userinfo', { bearer: noOpenid.tokens.access_token })
  assert.equal(denied.status, 403)
})

test('/userinfo: sem o escopo email, não devolve o email', async () => {
  const u = await makeUser('m3')
  const { tokens } = await getTokens(u.s, { scope: 'openid' })
  const r = await new Session().get('/userinfo', { bearer: tokens.access_token })
  assert.equal(r.status, 200)
  assert.equal(r.json.email, undefined)
})

bonus('um id_token NÃO pode ser aceito como access token na API', async () => {
  const u = await makeUser('m3')
  const { tokens } = await getTokens(u.s, { scope: 'openid profile' })
  const r = await new Session().get('/api/profile', { bearer: tokens.id_token })
  assert.equal(r.status, 401)
})

bonus('as chaves do JWKS têm kid único', async () => {
  const set = await jwks(await discovery())
  const kids = set.keys.map((k: Json) => k.kid)
  assert.equal(new Set(kids).size, kids.length)
})
