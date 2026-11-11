// MARCO 1 — cadastro, login e sessão por cookie.
//
// Contrato:
//   POST /register {email, password}  -> 201 {id, email} | 400 (email inválido ou senha < 12 chars) | 409 (email já existe)
//   POST /login    {email, password}  -> 200 {id, email} + Set-Cookie "sid" (HttpOnly, SameSite) | 401 (credenciais inválidas)
//   GET  /me                          -> 200 {id, email} com cookie válido | 401 sem cookie
//   POST /logout                      -> 204; a sessão deixa de valer
//
// Itens que não dá para testar de fora (confira à mão):
//   [ ] a senha é guardada com hash lento e com salt (argon2id, scrypt ou bcrypt), nunca em texto
//   [ ] o cookie ganha o atributo Secure quando NODE_ENV=production
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { PASSWORD, Session, bonus, rnd } from './helpers'

const newEmail = () => `m1-${rnd()}@example.test`

test('register: cria o usuário e não devolve a senha nem o hash', async () => {
  const s = new Session()
  const email = newEmail()
  const r = await s.post('/register', { email, password: PASSWORD })
  assert.equal(r.status, 201, r.text)
  assert.equal(r.json.email, email)
  assert.ok(r.json.id, 'resposta deve ter id')
  assert.ok(!r.text.includes(PASSWORD), 'a resposta não pode conter a senha')
  assert.ok(
    !/pass|hash/i.test(Object.keys(r.json).join(',')),
    'nenhum campo de senha/hash na resposta',
  )
})

test('register: email repetido -> 409', async () => {
  const s = new Session()
  const email = newEmail()
  assert.equal((await s.post('/register', { email, password: PASSWORD })).status, 201)
  assert.equal((await s.post('/register', { email, password: PASSWORD })).status, 409)
})

test('register: senha com menos de 12 caracteres -> 400', async () => {
  const s = new Session()
  const r = await s.post('/register', { email: newEmail(), password: 'curta123' })
  assert.equal(r.status, 400)
})

test('register: email inválido -> 400', async () => {
  const s = new Session()
  const r = await s.post('/register', { email: 'isso-nao-e-email', password: PASSWORD })
  assert.equal(r.status, 400)
})

test('register: JSON malformado -> 400 (e não 500)', async () => {
  const s = new Session()
  const r = await s.req('POST', '/register', {
    raw: '{"email": ',
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(r.status, 400)
})

test('login: sucesso devolve cookie sid com HttpOnly e SameSite', async () => {
  const s = new Session()
  const email = newEmail()
  await s.post('/register', { email, password: PASSWORD })
  const r = await s.post('/login', { email, password: PASSWORD })
  assert.equal(r.status, 200, r.text)
  const sid = r.setCookies.find((c) => c.startsWith('sid='))
  assert.ok(sid, 'faltou Set-Cookie: sid=...')
  assert.match(sid, /;\s*HttpOnly/i, 'cookie sid precisa de HttpOnly')
  assert.match(sid, /;\s*SameSite=(Lax|Strict)/i, 'cookie sid precisa de SameSite=Lax ou Strict')
  const value = (sid.split(';')[0] ?? '').slice('sid='.length)
  assert.ok(value.length >= 32, 'o id de sessão deve ser longo e imprevisível (>= 32 chars)')
})

test('login: senha errada e usuário inexistente dão o MESMO 401 (sem enumeração de usuários)', async () => {
  const s = new Session()
  const email = newEmail()
  await s.post('/register', { email, password: PASSWORD })
  const wrongPassword = await s.post('/login', { email, password: 'outra-senha-bem-longa' })
  const unknownUser = await s.post('/login', { email: newEmail(), password: PASSWORD })
  assert.equal(wrongPassword.status, 401)
  assert.equal(unknownUser.status, 401)
  assert.equal(wrongPassword.text, unknownUser.text, 'o corpo da resposta deve ser idêntico')
})

test('/me: sem cookie -> 401; com cookie -> 200 com id e email', async () => {
  const s = new Session()
  assert.equal((await new Session().get('/me')).status, 401)
  const email = newEmail()
  await s.post('/register', { email, password: PASSWORD })
  await s.post('/login', { email, password: PASSWORD })
  const me = await s.get('/me')
  assert.equal(me.status, 200)
  assert.equal(me.json.email, email)
  assert.ok(me.json.id)
})

test('login: cada login gera um id de sessão novo (evita session fixation)', async () => {
  const email = newEmail()
  const a = new Session()
  await a.post('/register', { email, password: PASSWORD })
  const l1 = await a.post('/login', { email, password: PASSWORD })
  const sid1 = a.cookies.get('sid')
  const l2 = await a.post('/login', { email, password: PASSWORD })
  const sid2 = a.cookies.get('sid')
  assert.equal(l1.status, 200)
  assert.equal(l2.status, 200)
  assert.notEqual(sid1, sid2)
})

test('logout: 204 e o cookie antigo deixa de valer no servidor', async () => {
  const s = new Session()
  const email = newEmail()
  await s.post('/register', { email, password: PASSWORD })
  await s.post('/login', { email, password: PASSWORD })
  const stolen = s.cookies.get('sid')
  assert.equal((await s.post('/logout', {})).status, 204)

  const attacker = new Session()
  attacker.cookies.set('sid', stolen ?? '')
  assert.equal((await attacker.get('/me')).status, 401, 'sessão precisa ser invalidada no servidor')
})

bonus('rotas inexistentes devolvem JSON 404', async () => {
  const r = await new Session().get(`/nao-existe-${rnd()}`)
  assert.equal(r.status, 404)
  assert.ok(r.json, 'corpo deveria ser JSON')
})
