// MARCO 2 — servidor OAuth 2.0: Authorization Code + PKCE, escopos e refresh com rotação.
//
// Cliente pré-cadastrado (público, sem secret):
//   client_id    = demo-client
//   redirect_uri = http://localhost:4000/callback   (comparação EXATA)
//   escopos      = profile, email, openid
//
// Contrato:
//   GET  /authorize?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method=S256
//        - client_id/redirect_uri inválidos      -> 400 (NÃO redirecionar)
//        - sem sessão (cookie sid)               -> 302 para /login?... (qualquer querystring)
//        - sem code_challenge ou método != S256  -> 302 para redirect_uri com ?error=invalid_request&state=...
//        - ok                                    -> 302 para redirect_uri?code=...&state=... (consentimento automático)
//   POST /token  (application/x-www-form-urlencoded)
//        - grant_type=authorization_code: code, redirect_uri, client_id, code_verifier
//        - grant_type=refresh_token:      refresh_token, client_id
//        - sucesso: 200 {access_token, token_type:"Bearer", expires_in, refresh_token, scope} + Cache-Control: no-store
//        - erro:    400 {error: "invalid_grant" | "unsupported_grant_type" | ...}
//   GET  /api/profile  (Authorization: Bearer ...) -> 200 {id, email}
//        - sem token -> 401 + WWW-Authenticate: Bearer ; token inválido -> 401 invalid_token
//        - token sem escopo "profile" -> 403 insufficient_scope
//
// Fora do teste (confira à mão): o code expira em poucos minutos (ideal: 60 s) e é de uso único.

import { test } from 'bun:test'
import assert from 'node:assert/strict'
import {
  authorize,
  bonus,
  CLIENT_ID,
  getTokens,
  makeUser,
  pkce,
  REDIRECT_URI,
  Session,
  tokenRequest,
} from './helpers'

test('/authorize: sem sessão redireciona para /login', async () => {
  const a = await authorize(new Session())
  assert.equal(a.res.status, 302)
  assert.match(a.res.headers.get('location') ?? '', /\/login/)
})

test('/authorize: redirect_uri desconhecido -> 400 e nenhum redirect', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s, { redirect_uri: 'http://evil.example/callback' })
  assert.equal(a.res.status, 400)
  assert.equal(a.res.headers.get('location'), null)
})

test('/authorize: redirect_uri precisa casar EXATAMENTE (sem prefixo nem path extra)', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s, { redirect_uri: `${REDIRECT_URI}/extra` })
  assert.equal(a.res.status, 400)
})

test('/authorize: client_id desconhecido -> 400', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s, { client_id: 'nao-existe' })
  assert.equal(a.res.status, 400)
})

test('/authorize: PKCE é obrigatório (sem code_challenge -> error=invalid_request)', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s, { code_challenge: undefined, code_challenge_method: undefined })
  assert.equal(a.res.status, 302)
  assert.equal(`${a.loc?.origin}${a.loc?.pathname}`, REDIRECT_URI)
  assert.equal(a.error, 'invalid_request')
  assert.equal(a.state, a.params.state, 'o state deve voltar também nos erros')
})

test('/authorize: método plain não é aceito (só S256)', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s, { code_challenge_method: 'plain' })
  assert.equal(a.res.status, 302)
  assert.equal(a.error, 'invalid_request')
})

test('/authorize: escopo desconhecido -> error=invalid_scope', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s, { scope: 'profile admin' })
  assert.equal(a.res.status, 302)
  assert.equal(a.error, 'invalid_scope')
})

test('/authorize: caminho feliz devolve code e o MESMO state', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s)
  assert.equal(a.res.status, 302)
  assert.equal(`${a.loc?.origin}${a.loc?.pathname}`, REDIRECT_URI)
  assert.ok(a.code && a.code.length >= 20, 'code deve ser longo e imprevisível')
  assert.equal(a.state, a.params.state)
})

test('/token: troca o code e devolve access + refresh, sem cache', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s)
  const t = await tokenRequest(u.s, {
    grant_type: 'authorization_code',
    code: a.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: a.verifier,
  })
  assert.equal(t.status, 200, t.text)
  assert.ok(t.json.access_token)
  assert.ok(t.json.refresh_token)
  assert.match(t.json.token_type, /^bearer$/i)
  assert.ok(
    Number.isInteger(t.json.expires_in) && t.json.expires_in > 0 && t.json.expires_in <= 3600,
  )
  assert.equal(t.json.scope, 'profile')
  assert.match(t.headers.get('cache-control') ?? '', /no-store/i)
})

test('/token: code_verifier errado -> invalid_grant', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s)
  const t = await tokenRequest(u.s, {
    grant_type: 'authorization_code',
    code: a.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pkce().verifier,
  })
  assert.equal(t.status, 400)
  assert.equal(t.json.error, 'invalid_grant')
})

test('/token: redirect_uri diferente do usado no /authorize -> invalid_grant', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s)
  const t = await tokenRequest(u.s, {
    grant_type: 'authorization_code',
    code: a.code,
    redirect_uri: `${REDIRECT_URI}?x=1`,
    code_verifier: a.verifier,
  })
  assert.equal(t.status, 400)
  assert.equal(t.json.error, 'invalid_grant')
})

test('/token: o code só funciona uma vez', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s)
  const form = {
    grant_type: 'authorization_code',
    code: a.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: a.verifier,
  }
  assert.equal((await tokenRequest(u.s, form)).status, 200)
  const again = await tokenRequest(u.s, form)
  assert.equal(again.status, 400)
  assert.equal(again.json.error, 'invalid_grant')
})

test('/token: grant_type desconhecido -> unsupported_grant_type', async () => {
  const u = await makeUser('m2')
  const t = await tokenRequest(u.s, { grant_type: 'password', username: 'x', password: 'y' })
  assert.equal(t.status, 400)
  assert.equal(t.json.error, 'unsupported_grant_type')
})

test('/api/profile: exige Bearer válido', async () => {
  const u = await makeUser('m2')
  const none = await new Session().get('/api/profile')
  assert.equal(none.status, 401)
  assert.match(none.headers.get('www-authenticate') ?? '', /^Bearer/i)

  const bad = await new Session().get('/api/profile', { bearer: 'token-que-nao-existe' })
  assert.equal(bad.status, 401)

  const { tokens } = await getTokens(u.s)
  const ok = await new Session().get('/api/profile', { bearer: tokens.access_token })
  assert.equal(ok.status, 200, ok.text)
  assert.equal(ok.json.email, u.email)
})

test('/api/profile: token sem o escopo "profile" -> 403 insufficient_scope', async () => {
  const u = await makeUser('m2')
  const { tokens } = await getTokens(u.s, { scope: 'email' })
  const r = await new Session().get('/api/profile', { bearer: tokens.access_token })
  assert.equal(r.status, 403)
  assert.match(r.headers.get('www-authenticate') ?? '', /insufficient_scope/)
})

test('refresh: devolve novo access e NOVO refresh (rotação)', async () => {
  const u = await makeUser('m2')
  const { tokens } = await getTokens(u.s)
  const r = await tokenRequest(u.s, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  })
  assert.equal(r.status, 200, r.text)
  assert.ok(r.json.access_token && r.json.access_token !== tokens.access_token)
  assert.ok(r.json.refresh_token && r.json.refresh_token !== tokens.refresh_token)
  const api = await new Session().get('/api/profile', { bearer: r.json.access_token })
  assert.equal(api.status, 200)
})

test('refresh: reusar um refresh antigo falha E derruba a "família" inteira', async () => {
  const u = await makeUser('m2')
  const { tokens } = await getTokens(u.s)
  const first = await tokenRequest(u.s, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  })
  assert.equal(first.status, 200)

  const replay = await tokenRequest(u.s, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  })
  assert.equal(replay.status, 400)
  assert.equal(replay.json.error, 'invalid_grant')

  // o refresh "legítimo" mais novo também foi revogado (suspeita de roubo)
  const newest = await tokenRequest(u.s, {
    grant_type: 'refresh_token',
    refresh_token: first.json.refresh_token,
  })
  assert.equal(newest.status, 400)
  assert.equal(newest.json.error, 'invalid_grant')
})

bonus('reusar o code revoga os tokens já emitidos com ele (RFC 6749 §4.1.2)', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s)
  const form = {
    grant_type: 'authorization_code',
    code: a.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: a.verifier,
  }
  const t = await tokenRequest(u.s, form)
  assert.equal(t.status, 200)
  await tokenRequest(u.s, form) // replay
  const api = await new Session().get('/api/profile', { bearer: t.json.access_token })
  assert.equal(api.status, 401)
})

bonus('refresh não pode ampliar o escopo', async () => {
  const u = await makeUser('m2')
  const { tokens } = await getTokens(u.s, { scope: 'email' })
  const r = await tokenRequest(u.s, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    scope: 'email profile',
  })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'invalid_scope')
})

bonus('code emitido para um client_id não funciona com outro', async () => {
  const u = await makeUser('m2')
  const a = await authorize(u.s)
  const t = await tokenRequest(u.s, {
    grant_type: 'authorization_code',
    client_id: `${CLIENT_ID}-outro`,
    code: a.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: a.verifier,
  })
  assert.equal(t.status, 400)
})
