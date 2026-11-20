# Guia do projeto — tiny-idp (marco a marco)

Nov 11, 2026 · @Guilherme

## Como usar este guia

Você escreve todo o código do servidor em `src/`. O repositório já traz o que **não** é o exercício: os testes de aceite (a especificação de cada marco), um console no navegador para testar à mão e a configuração da stack. Cada marco tem o mesmo formato: objetivo, uma referência principal, contrato da API, passo a passo, o que experimentar no console, critérios de aceite e o commit sugerido.

**O que você tem**

- **Repositório `guishas/tiny-idp`** (público): `test/` com os testes de aceite, `console/` com a central de comando, `src/` com três arquivos de partida (`app.ts`, `server.ts`, `env.ts`) e um README em inglês que descreve o projeto.
- **`tiny-idp-reference.zip`**: a solução de referência, na mesma stack, com um arquivo por marco. **Só abra o arquivo de um marco depois de terminá-lo.** Ela nunca vai para o seu repositório.

**Stack (a mesma do seu `clinica360-backend`)**

- Bun como runtime, gerenciador de pacotes e executor de testes (`bun test`, arquivos `*.spec.ts`)
- TypeScript estrito, com o alias `@/` apontando para `src/`
- Fastify para HTTP e Zod para validar entrada
- Biome com o seu estilo: aspas simples, sem ponto e vírgula, 100 colunas
- Sem banco de dados: estado em `Map`. Hash de senha com `Bun.password` (argon2id, já embutido no Bun)

**Como os testes funcionam.** São testes de caixa-preta: falam HTTP com o servidor em `http://localhost:3000` e não importam nada de `src/`. Por isso a estrutura interna do seu código é livre. Se você já estiver com `bun dev` rodando, eles usam esse servidor; se não, o `bun test` sobe o `src/server.ts` sozinho durante a execução e o derruba no fim.

**O ciclo de cada marco**

1. Leia a seção do marco (15 min) e o cabeçalho do arquivo de teste correspondente, que repete o contrato.
2. Deixe `bun dev` rodando em um terminal e `bun run console` em outro.
3. Implemente seguindo o passo a passo. A cada rota nova, rode `bun run test:m1` (ou `m2`, `m3`...) e experimente no console.
4. Com todos os testes do marco verdes, marque o marco no README (`- [x]`) e faça o commit sugerido.
5. Só então abra o arquivo daquele marco na referência e compare as decisões.

**Regras**

- Não altere `test/` nem `console/`. Se um teste parecer errado, anote o motivo e me mande: eu verifico se o erro é meu.
- Os nomes de rota e os formatos são o contrato. Mudar qualquer um quebra os testes, e isso é de propósito.
- O que não dá para testar de fora (como o hash da senha) aparece como item manual nos critérios de aceite.
- Testes marcados com `[bônus]` ficam desligados por padrão. Rode-os com `bun run test:bonus` quando o marco estiver verde.

**Estimativa por marco (3 a 4h por dia):** M1 2h, M2 5h, M3 3h, M4 4h, M5 4h, M6 1,5h, M7 1,5h. São estimativas minhas, não medidas, e somam cerca de 21h, mais do que as 90 a 120 min diárias que o plano reserva para construir. Como você já integrou OAuth e SSO, encurte o bloco "Aprender" dos dias 2 e 3 e use esse tempo no código. Se ainda assim um marco estourar, use o atalho indicado na seção: saber explicar vale mais do que ter todos os testes verdes.

## Preparação (20 min, antes do Marco 1)

**Instalar e rodar**

```bash
git clone https://github.com/guishas/tiny-idp && cd tiny-idp
bun install            # gera o bun.lock; faça commit dele
bun dev                # servidor em http://localhost:3000 (reinicia ao salvar)
bun run console        # em outro terminal: console em http://localhost:4000
curl localhost:3000/health   # {"status":"ok"}
```

O repositório já está clonado em `~/dev/www/tiny-idp`, com as dependências instaladas, o Biome aplicado e o `bun.lock` no GitHub. Os comandos acima servem para montar o projeto em outra máquina.

**Scripts**

| Comando | O que faz |
| --- | --- |
| `bun dev` | servidor com reinício automático |
| `bun run console` | central de comando em `localhost:4000` |
| `bun run test:m1` ... `test:m7` | testes de um marco |
| `bun run test:api` | marcos 1 a 5 de uma vez |
| `bun run test:bonus` | tudo, incluindo os testes bônus |
| `bun test -t "code_verifier"` | só os testes cujo nome contém o texto |
| `bun run lint:fix` e `bun run typecheck` | Biome e TypeScript |

**Estrutura sugerida para `src/`** (inspirada no seu backend; não é obrigatória)

```
src/
  app.ts                      instância do Fastify, plugins e registro das rotas
  server.ts                   ponto de entrada
  env.ts                      variáveis de ambiente validadas com Zod
  store.ts                    os Maps em memória e os tipos (User, Session, Org...)
  http/
    error-handler.ts          traduz erros em respostas JSON
    controllers/
      auth/routes.ts          marco 1
      oauth/routes.ts         marco 2
      oidc/routes.ts          marco 3
      orgs/routes.ts          marco 4
      mfa/routes.ts           marco 5
  authz/can.ts                a função can() do marco 4
  lib/                        crypto, totp, jwt
```

**Duas convenções que valem para todos os marcos**

- **Validação:** um schema Zod por corpo de requisição e `schema.safeParse(request.body)`. Se falhar, responda `400`. Não confie em nenhum campo sem passar pelo schema.
- **Erros:** crie uma classe `HttpError(status, code)` e um `app.setErrorHandler` que a converte em `{ error: code }`. Qualquer outro erro vira `500 { error: 'server_error' }`, com o detalhe apenas no log. O Fastify já responde `400` para JSON malformado; garanta que o seu handler preserve esse status (`error.statusCode`).

**O console.** Abra `http://localhost:4000`. Ele tem uma aba por marco e um log de todas as requisições à direita. Os botões vermelhos são ataques que o seu servidor precisa recusar. Ele também é o aplicativo cliente do Marco 2: o `redirect_uri` cadastrado aponta para ele. Use sempre `localhost` (não `127.0.0.1`), porque o cookie de sessão precisa valer para as duas portas. Enquanto uma rota não existir, o botão correspondente mostra `404`, e isso é esperado.

## Marco 1 (dia 1): cadastro, login e sessão

**Objetivo:** usuários com senha guardada em hash lento e sessão por cookie, controlada no servidor. Tempo: \~2h. Teste: `test/m1-auth.spec.ts`.

**Referência principal:** [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) (seções de senha e de mensagens de erro). Opcional: [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

**Contrato da API**

| Rota | Entrada | Sucesso | Erros |
| --- | --- | --- | --- |
| `POST /register` | JSON `{email, password}` | `201 {id, email}` | `400` email inválido ou senha com menos de 12 caracteres; `409` email já existe |
| `POST /login` | JSON `{email, password}` | `200 {id, email}` + cookie `sid` | `401` credenciais inválidas (corpo idêntico para usuário inexistente e senha errada) |
| `GET /me` | cookie `sid` | `200 {id, email}` | `401` sem sessão válida |
| `POST /logout` | cookie `sid` | `204` e a sessão morre no servidor | não há |

JSON malformado em qualquer rota deve dar `400`, nunca `500`.

**Passo a passo**

- [x] `bun add @fastify/cookie` e registre o plugin em `app.ts`
- [x] `src/store.ts`: `users` (por id), `usersByEmail` e `sessions` como `Map`
- [x] `HttpError` e `app.setErrorHandler` (veja a Preparação)
- [x] `POST /register`: schema Zod (`z.email()`, senha com `min(12)`), email normalizado para minúsculas, `409` em duplicado
- [x] Hash com `await Bun.password.hash(password)`: argon2id com salt, sem instalar nada. Nunca devolva nem registre em log a senha ou o hash
- [x] `POST /login`: `Bun.password.verify`. Para usuário inexistente, verifique contra um hash falso gerado na subida do servidor, para gastar o mesmo tempo. Mesma resposta nos dois erros
- [x] Sessão: id com `randomBytes(32).toString('base64url')`, guardado no `Map`. Cookie com `reply.setCookie('sid', id, { httpOnly: true, sameSite: 'lax', path: '/', secure: env.NODE_ENV === 'production' })`
- [x] Cada login cria um id novo e apaga a sessão anterior do mesmo navegador (evita *session fixation*)
- [x] `GET /me` lê `request.cookies.sid`; `POST /logout` apaga a sessão **no servidor** e chama `reply.clearCookie('sid', { path: '/' })`
- [x] Extraia um `requireUser(request)` que devolve `{ user, session }` ou lança `401`: todos os marcos seguintes usam

**No console (aba 1 · Session):** "Register + log in" e veja o seu email no topo. Abra a requisição de login no log: a linha `x-console-set-cookie` mostra os atributos do cookie que o seu servidor enviou. Os botões "Login with a wrong password" e "Login as unknown user" precisam devolver respostas idênticas.

**Cuidado com o Fastify:** uma requisição com `content-type: application/json` e corpo vazio recebe `400` antes de chegar à sua rota. Os testes e o console não fazem isso, mas você vai esbarrar nisso com `curl -X POST -H 'content-type: application/json'` sem `-d`.

**Critérios de aceite**

- [x] `bun run test:m1` com 10 testes verdes (mais 1 bônus)
- [x] Manual: a senha é guardada como hash argon2id (começa com `$argon2id$`) e nunca aparece em log
- [x] Manual: com `NODE_ENV=production` o cookie ganha `Secure`

**Commit sugerido:** `feat: registration, login and server-side sessions`

**Depois de terminar, compare com:** `src/routes/m1-auth.ts` da referência.

## Marco 2 (dia 2, com sobra no dia 3): servidor OAuth 2.0 com PKCE

**Objetivo:** seu servidor passa a emitir tokens para um aplicativo cliente com Authorization Code + PKCE, escopos e refresh token com rotação. É o marco mais pesado: \~5h. A parte 2 (rotação de refresh) pode ficar para o início do dia 3. Teste: `test/m2-oauth.spec.ts`.

**Referência principal:** [OAuth 2.0 Simplified, Authorization Code + PKCE](https://www.oauth.com/oauth2-servers/pkce/). Opcionais: [RFC 7636 (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636) para um detalhe específico e o [OAuth 2.0 Security BCP (RFC 9700)](https://datatracker.ietf.org/doc/html/rfc9700) quando ficar curioso sobre os ataques.

**Cliente pré-cadastrado (fixo no código)**

- `client_id`: `demo-client` (público, sem secret). Na prática, é o console
- `redirect_uri`: `http://localhost:4000/callback`, comparada de forma **exata**
- escopos permitidos: `profile`, `email`, `openid`

**Contrato da API**

| Rota | Entrada | Respostas |
| --- | --- | --- |
| `GET /authorize` | query: `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256` | `client_id` ou `redirect_uri` inválidos: `400` **sem redirecionar**; sem sessão: `302` para `/login?...`; sem PKCE ou método diferente de S256: `302` para o `redirect_uri` com `error=invalid_request` e o `state`; escopo desconhecido: `302` com `error=invalid_scope`; ok: `302` para o `redirect_uri` com `code` e o mesmo `state` |
| `POST /token` (form-urlencoded) | `authorization_code`: `code`, `redirect_uri`, `client_id`, `code_verifier`. `refresh_token`: `refresh_token`, `client_id` | `200 {access_token, token_type:"Bearer", expires_in, refresh_token, scope}` com `Cache-Control: no-store`; erro: `400 {error}` com `invalid_grant` ou `unsupported_grant_type` |
| `GET /api/profile` | `Authorization: Bearer ...` | `200 {id, email}`; sem token: `401` + `WWW-Authenticate: Bearer`; token inválido: `401`; sem o escopo `profile`: `403 insufficient_scope` |

**Passo a passo, parte 1: o fluxo do code**

- [x] `bun add @fastify/formbody` e registre o plugin: o `/token` recebe `application/x-www-form-urlencoded`, não JSON
- [x] Registre o cliente `demo-client` e valide o `redirect_uri` por igualdade exata (nada de `startsWith`)
- [x] `GET /authorize`: valide `client_id` e `redirect_uri` **antes** de qualquer redirect. Só depois trate os demais erros, redirecionando para o `redirect_uri` com `error` e `state`
- [x] Sem sessão do Marco 1, `reply.redirect('/login?...')`. Não precisa existir uma tela de login
- [x] Aceite apenas `code_challenge_method=S256`; recuse `plain` e a ausência de PKCE
- [x] Gere o `code` (32 bytes aleatórios) e guarde com ele: `client_id`, `redirect_uri`, `code_challenge`, usuário, escopo e validade de 60 s. Devolva o mesmo `state` recebido
- [x] `POST /token` com `authorization_code`: confira `client_id`, `redirect_uri` idêntico ao do `/authorize`, expiração e que `createHash('sha256').update(code_verifier).digest('base64url')` é igual ao `code_challenge`
- [x] O `code` vale uma única vez: marque-o como usado **antes** das demais checagens, para que uma troca que falha também o queime
- [x] Access token opaco (32 bytes aleatórios) com \~10 min de vida, guardado em um `Map` com usuário, cliente e escopo. `reply.header('cache-control', 'no-store')`
- [x] `GET /api/profile`: leia o Bearer, valide, exija o escopo `profile`

**Passo a passo, parte 2: refresh com rotação**

- [x] Cada troca de `code` cria uma "família" (um id aleatório) que acompanha todos os tokens derivados dela
- [x] `grant_type=refresh_token`: emite um access e um refresh novos e marca o refresh antigo como usado
- [x] Se um refresh **já usado** aparecer de novo, revogue a família inteira: alguém tem uma cópia
- [x] Bônus: reusar um `code` revoga os tokens emitidos com ele; refresh não amplia escopo; `code` de um cliente não serve para outro

**No console (aba 2 · OAuth):** faça login na aba 1 e clique em "Start the flow". O navegador vai ao seu `/authorize` e volta para o console com o `code`; o console confere o `state` e troca o `code` por tokens. Depois experimente, nesta ordem: "Refresh", "Replay the previous refresh token" (precisa dar `400`) e "GET /api/profile" (agora precisa dar `401`, porque a família foi revogada). Teste também "Exchange with a wrong code\_verifier" e "Reuse the same code".

**Atalho se o tempo apertar:** deixe a parte 2 (rotação e família) por último. Com o fluxo do `code` funcionando você já passa 15 dos 17 testes e consegue explicar o resto na triagem.

**Critérios de aceite**

- [x] `bun run test:m2` com 17 testes verdes (mais 3 bônus)
- [x] Manual: o `code` expira em 60 s (espere um minuto no console antes de trocar)
- [x] Manual: nenhum token nem `code` aparece em log
- [x] Você explica em voz alta, sem olhar, por que o PKCE impede o uso de um `code` roubado e para que serve o `state`

**Commit sugerido:** `feat: OAuth 2.0 authorization code flow with PKCE and refresh rotation`

**Depois de terminar, compare com:** `src/routes/m2-oauth.ts` da referência.

## Marco 3 (dia 3): OpenID Connect em cima do OAuth

**Objetivo:** transformar o servidor do Marco 2 em um provedor OIDC: discovery, JWKS, `id_token` assinado e `/userinfo`. Tempo: \~3h. Teste: `test/m3-oidc.spec.ts`.

**Referência principal:** [OpenID Connect Core 1.0, seção 3.1.3.7 (validação do ID Token)](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation). Leia só essa seção e a lista de claims logo antes dela. Opcional: [jwt.io Introduction](https://jwt.io/introduction) se a estrutura do JWT ainda estiver nebulosa.

**Contrato da API**

| Rota | Resposta |
| --- | --- |
| `GET /.well-known/openid-configuration` | `200` JSON com `issuer`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, `response_types_supported` (com `code`), `scopes_supported` (com `openid`), `subject_types_supported`, `id_token_signing_alg_values_supported` (RS256 ou ES256, nunca `none`) e `code_challenge_methods_supported` (com `S256`) |
| `GET` no caminho de `jwks_uri` (sugestão: `/jwks.json`) | `{keys:[{kty, kid, alg, use:"sig", ...}]}` só com a parte **pública** |
| `POST /token` com `scope` contendo `openid` | a resposta ganha `id_token`: JWT assinado com `iss`, `sub`, `aud` (= `client_id`), `exp`, `iat` e `nonce` (quando enviado no `/authorize`) |
| `GET /userinfo` (Bearer) | `200 {sub, email}`; `email` só com o escopo `email`; exige o escopo `openid` |

Sem o escopo `openid`, **não** pode haver `id_token`.

**Passo a passo**

- [x] Gere o par de chaves ao subir o servidor: `generateKeyPairSync('rsa', { modulusLength: 2048 })` de `node:crypto`, e um `kid` aleatório
- [x] JWKS: `publicKey.export({ format: 'jwk' })` mais `kid`, `alg: 'RS256'` e `use: 'sig'`. Confira que nenhum campo privado (`d`, `p`, `q`...) aparece
- [x] Discovery: use `env.ISSUER` (já vem **sem barra final** em `src/env.ts`) e o mesmo valor no `iss` dos tokens
- [x] Guarde o `nonce` do `/authorize` junto do `code` e devolva-o no `id_token`
- [x] Assine o JWT à mão na primeira vez: `base64url(header).base64url(payload)` e `sign('RSA-SHA256', Buffer.from(input), privateKey)`. São 5 linhas e você enxerga cada parte
- [x] `sub` é o `id` do usuário (estável e opaco), nunca o email
- [x] `/userinfo`: Bearer válido com o escopo `openid`; `sub` igual ao do `id_token`; `email` apenas com o escopo `email`
- [x] Bônus: um `id_token` enviado como Bearer precisa ser recusado. Com access tokens opacos isso já acontece sozinho; entenda por quê

**No console (aba 3 · OIDC):** refaça o fluxo da aba 2 com o escopo `openid` marcado e clique em "Decode and validate the id\_token". O console faz no navegador as checagens que um cliente de verdade faria (assinatura com a chave do JWKS, `iss`, `aud`, `exp`, `nonce`) e mostra cada uma como `pass` ou `FAIL`. O botão "Use the id\_token as an access token" precisa dar `401`.

**Atalho se o tempo apertar:** `bun add jose` e use `SignJWT`, `exportJWK` e `generateKeyPair`. O objetivo é saber explicar cada claim, não ter escrito o JWT à mão.

**Critérios de aceite**

- [x] `bun run test:m3` com 7 testes verdes (mais 2 bônus)
- [x] Manual: no console, todas as checagens do `id_token` aparecem como `pass`
- [x] Você sabe dizer o que cada claim (`iss`, `sub`, `aud`, `exp`, `nonce`) protege, e a diferença entre `id_token` e access token

**Commit sugerido:** `feat: OpenID Connect discovery, JWKS, id_token and userinfo`

**Depois de terminar, compare com:** `src/routes/m3-oidc.ts` da referência.

## Marco 4 (dia 4): organizações, papéis customizados e `can()`

**Objetivo:** o coração da vaga de IAM: autorização multi-tenant com papéis criados pelo cliente, uma função `can()` que nega por padrão e delegação temporária. Tempo: \~4h. A autenticação aqui é o cookie do Marco 1. Teste: `test/m4-authz.spec.ts`.

**Referência principal:** [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (negar por padrão, validar a permissão em toda requisição, evitar IDOR). Opcional: o resumo do [paper do Zanzibar](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/), só para conhecer a ideia de autorização por relacionamentos.

**Catálogo fixo de permissões:** `invoice:create`, `invoice:read`, `invoice:read:own`, `invoice:approve`, `role:manage`, `member:manage`, `delegation:manage`, `audit:read`.

**Contrato da API** (todas exigem sessão)

| Rota | Sucesso | Erros |
| --- | --- | --- |
| `POST /orgs {name}` | `201 {id, name}`; quem cria vira membro com o papel embutido `owner` (todas as permissões) | `401` sem sessão |
| `GET /orgs/:orgId` | `200 {id, name}` para membros | `404` para quem não é membro (não revela que a org existe) |
| `POST /orgs/:orgId/roles {name, permissions[]}` | `201 {id, name, permissions}` | `400` permissão desconhecida; `403` sem `role:manage` ou tentando conceder permissão que você não tem |
| `POST /orgs/:orgId/members {email, roleId}` | `201` | `404` usuário inexistente; `400` papel de outra org; `409` já é membro; `403` sem `member:manage` ou papel com permissões que você não tem |
| `PUT /orgs/:orgId/members/:userId {roleId}` | `200` | mesmas regras |
| `POST /orgs/:orgId/invoices {amount}` | `201 {id, amount, ownerId}` (inteiro positivo, em centavos) | `403` sem `invoice:create` |
| `GET /orgs/:orgId/invoices` | `200 [...]`: com `invoice:read` vê todas; só com `invoice:read:own` vê as suas | `403` sem nenhuma das duas |
| `GET /orgs/:orgId/invoices/:id` | `200` | `404` se não existe, é de outra org, ou é de outra pessoa e você só tem `read:own` |
| `POST /orgs/:orgId/invoices/:id/approve` | `200 {id, status:"approved"}` | `403` sem `invoice:approve` |
| `POST /orgs/:orgId/delegations {toEmail, permissions[], expiresInSeconds}` | `201 {id}` | `403` delegando permissão que você não tem; `400` `expiresInSeconds` fora de 1..604800; `404` destinatário não é membro |
| `DELETE /orgs/:orgId/delegations/:id` | `204` (o delegante, ou quem tem `delegation:manage`) | `403`, `404` |

**A regra do `can(org, userId, permission)`**

1. **Negar por padrão:** sem concessão explícita, a resposta é `false`.
2. A permissão vem do papel do usuário **naquela** organização, ou de uma delegação ativa (não expirada, não revogada) cujo delegante **ainda** tem a permissão pelo papel dele.
3. Delegação não encadeia: quem recebeu não delega de novo.
4. Toda rota pergunta ao `can()`. Nenhuma rota decide permissão por conta própria.

**Passo a passo**

- [x] Tipos e `Map`s em `store.ts`: `Org` com `roles`, `members` (usuário → papel), `invoices` e `delegations`
- [x] Escreva `src/authz/can.ts` **primeiro**, sem Fastify. É uma função pura: faça-a devolver também *por que* permitiu (`via: 'role' | 'delegation'` e o delegante). O Marco 5 vai precisar disso
- [x] Um helper `getOrg(request)` que carrega a org da rota e confere se o usuário é membro; se não for, `404`
- [x] `POST /orgs` cria o papel `owner` com todas as permissões
- [x] Schema Zod com `z.enum(PERMISSIONS)`: permissão desconhecida vira `400` sem código extra
- [x] Trava **anti-escalonamento** em roles, members e delegations: ninguém concede permissão que não possui pelo próprio papel
- [x] Faturas: busque sempre **dentro** da org da rota (`org.invoices.get(id)`), nunca em um `Map` global de faturas. É isso que evita IDOR entre organizações
- [x] Listagem: com apenas `invoice:read:own`, filtre por `ownerId` no servidor
- [x] Detalhe de fatura alheia (com `read:own`) ou de outra org: `404`, não `403`
- [x] Delegação com validade; se o delegante perder a permissão, ela para de valer na hora (o `can()` consulta o papel do delegante no momento da checagem)
- [x] Revogação por quem criou ou por quem tem `delegation:manage`

**No console (aba 4 · Orgs & roles):** crie dois usuários na aba 1. Como o primeiro: crie a org, um papel `accountant` só com `invoice:create` e `invoice:read:own`, e adicione o segundo como membro. Crie uma fatura. Use "Switch user" (no topo) para virar o segundo usuário e clique em "List invoices": a fatura do dono não pode aparecer, e "Approve" precisa dar `403`. Volte ao dono, delegue `invoice:approve` por 300 s e repita.

**Atalho se o tempo apertar:** faça `can()` só com papéis e as rotas de org, roles, members e invoices; deixe a delegação para o fim. Os testes de delegação vão falhar e dizer exatamente o que falta.

**Critérios de aceite**

- [x] `bun run test:m4` com 15 testes verdes (mais 1 bônus: delegação não encadeia)
- [x] Manual: no código não existe `if (role.name === 'owner')`; só `can(...)`
- [ ] Você explica RBAC, ABAC e ReBAC usando este marco como exemplo: papéis são RBAC, `read:own` é uma regra de atributo, delegação é uma relação entre duas pessoas

**Commit sugerido:** `feat: multi-tenant orgs, custom roles, deny-by-default can() and delegation`

**Depois de terminar, compare com:** `src/routes/m4-authz.ts` da referência.

## Marco 5 (dia 5): MFA, step-up e audit log

**Objetivo:** adicionar um segundo fator (TOTP), exigir autenticação recente e forte para ações sensíveis (step-up) e registrar quem fez o quê (audit log). Tempo: \~4h. Teste: `test/m5-mfa-audit.spec.ts`.

**Sobre passkeys:** o plano do dia 5 fala em passkeys, mas elas não dão para testar de forma automatizada sem um autenticador de verdade. O fator **testável** deste marco é o TOTP; passkeys ficam como parte manual e opcional, no fim da seção. O conceito de step-up é o mesmo com qualquer fator.

**Referência principal:** [RFC 9470, Step Up Authentication Challenge Protocol](https://datatracker.ietf.org/doc/html/rfc9470) (a introdução e a seção do erro `insufficient_user_authentication`; é curta). Para o TOTP, o [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238) é material de consulta: o algoritmo cabe em 15 linhas.

**Contrato da API**

| Rota | Resposta |
| --- | --- |
| `GET /me` | passa a devolver também `acr` (`"pwd"` ou `"mfa"`) e `auth_time` (segundos Unix) |
| `POST /mfa/totp/enroll` | `200 {secret, otpauth_uri}`: `secret` em base32 e `otpauth_uri` começando com `otpauth://totp/`; precisa de sessão |
| `POST /mfa/totp/confirm {code}` | `204` ativa o MFA; `400` se o código estiver errado |
| `POST /stepup {code}` | `204`: a sessão vira `acr:"mfa"` com `auth_time` = agora; `401` código errado; `409` MFA não ativado. Aceite o código da janela atual e de ±1 janela de 30 s |
| `POST /orgs/:o/invoices/:i/approve` com `amount >= 100000` | exige sessão `acr:"mfa"` com `auth_time` de no máximo 300 s atrás; senão, `401` com o header `WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values="mfa", max_age="300"` e o corpo `{error:"insufficient_user_authentication", acr_values:"mfa", max_age:300}` |
| `GET /orgs/:o/audit?limit=N` | `200 [eventos]` do mais novo para o mais antigo; exige `audit:read` (senão `403`) |

**Ordem das checagens na aprovação** (os testes cobram): fatura não existe → `404`; sem `invoice:approve` → `403`, **nunca** `401`; valor alto sem step-up recente → `401` com o desafio; senão → `200`. O motivo: o `401` ensina o cliente a se reautenticar, e quem não tem a permissão não deve ser convidado a fazer MFA por uma ação que nunca poderá executar.

**Evento de audit:** `{id, ts, actor, subject, on_behalf_of, action, resource, outcome, request_id}`

- `ts`: ISO 8601
- `action`: `role.created`, `member.added`, `delegation.created`, `delegation.revoked`, `invoice.created`, `invoice.approve`
- `outcome`: `success`, `denied` ou `step_up_required`
- `on_behalf_of`: id do delegante, quando a ação só foi permitida por uma delegação
- `request_id`: o header `X-Request-Id` recebido (ou um gerado), devolvido também na resposta
- O audit é **append-only**: não existe `PUT`, `PATCH` nem `DELETE` em `/audit`

**Passo a passo**

- [x] `src/lib/totp.ts`: segredo de 20 bytes aleatórios, codificado em base32. O código é um HMAC-SHA1 do contador `Math.floor(Date.now() / 30000)` (8 bytes, big-endian) com *dynamic truncation* para 6 dígitos
- [x] `otpauth_uri`: `otpauth://totp/tiny-idp:EMAIL?secret=...&issuer=tiny-idp`
- [x] Verificação com janela de ±1 passo e comparação em tempo constante (`timingSafeEqual`)
- [x] A sessão ganha `acr` e `authTime`: o login por senha define `acr: 'pwd'`; o `/stepup` muda para `'mfa'` e atualiza o `authTime`
- [x] Aprovação: a ordem de checagens acima e o header do RFC 9470 exatamente como no contrato
- [x] `audit(org, evento)`: uma função única que faz `push` em `org.audit`, chamada pelas rotas, inclusive nas tentativas **negadas**
- [x] `on_behalf_of` vem do retorno do `can()` (por isso ele devolve por onde permitiu)
- [x] `request_id`: um hook `onRequest` que lê ou gera o id e o devolve no header da resposta
- [x] Nunca registre senha, token, segredo TOTP nem id de sessão no audit (o teste procura o id de sessão)
- [x] Bônus anti-replay: guarde o último contador aceito e recuse um código de contador igual ou anterior

**No console (aba 5 · MFA & audit):** "Enroll" e depois "Confirm with the current code". O console faz o papel do aplicativo autenticador e mostra o código atual; adicione o mesmo segredo a um aplicativo de verdade uma vez e confira que os dois mostram o mesmo número. Na aba 4, crie uma fatura de `150000` e clique em "Approve": aparece o aviso de step-up com os parâmetros do desafio. Faça o step-up, aprove de novo e depois carregue o audit: precisam aparecer `step_up_required` e, em seguida, `success`.

**Atalho se o tempo apertar:** TOTP e step-up primeiro (é a parte conceitual que mais aparece em entrevista), audit depois. Se faltar tempo para o anti-replay, anote-o como pendência em "Security notes" no README.

**Parte manual e opcional: passkeys.** O bônus automático pede apenas `POST /webauthn/register/options` devolvendo `{challenge, rp:{id,name}, user:{id,name}}`, com um challenge novo a cada chamada. Para ir além, use `@simplewebauthn/server` e teste com o autenticador virtual do Chrome DevTools. Não gaste mais de 1h nisso, e só com os testes obrigatórios verdes.

**Critérios de aceite**

- [x] `bun run test:m5` com 12 testes verdes (mais 2 bônus)
- [x] Manual: um aplicativo autenticador real mostra o mesmo código que o console
- [x] Manual: no audit, uma aprovação feita por delegação traz o `on_behalf_of`
- [ ] Você explica por que "MFA no login" não basta para ações de alto risco e o que o `max_age` controla

**Commit sugerido:** `feat: TOTP MFA, RFC 9470 step-up challenge and append-only audit log`

**Depois de terminar, compare com:** `src/routes/m5-mfa-audit.ts` da referência.

## Marcos 6 e 7 (dias 6 e 7): arquitetura, modelo de ameaças e repositório apresentável

**Objetivo:** transformar código que funciona em algo que um entrevistador entende em três minutos. Tempo: \~1,5h no dia 6 para o Marco 6 e \~1,5h no dia 7 para o Marco 7, antes da prova final.

### Marco 6: `ARCHITECTURE.md`

**Referência principal:** [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html). A ideia: desenhar o sistema, listar o que pode dar errado (o STRIDE é um jeito comum de montar essa lista), decidir a resposta a cada ameaça e revisar.

Crie `ARCHITECTURE.md` na raiz, em inglês, com:

- [x] Um diagrama em um bloco de código `mermaid` (o GitHub renderiza). Sugestão: um `sequenceDiagram` do fluxo Authorization Code + PKCE entre navegador, console e o seu servidor
- [x] `## Components`: uma ou duas linhas por componente (sessões, OAuth, OIDC, autorização, MFA e step-up, audit)
- [x] `## Threat model`: uma tabela com **pelo menos 6 ameaças** em 3 colunas: ameaça, mitigação, onde está no código (arquivo e função)
- [x] `## Decisions and trade-offs`: pelo menos 3 itens, cada um com o que você escolheu e o que perdeu com a escolha (ex.: tokens opacos em vez de JWT, estado em memória, `404` em vez de `403`)

Ameaças que você já enfrentou e sabe defender: roubo de `code`, `redirect_uri` aberto, CSRF no callback, replay de refresh token, enumeração de usuários no login, *session fixation*, escalonamento de privilégio por criação de papel, acesso entre organizações, `id_token` usado como access token, replay de código TOTP e ação sensível sem autenticação recente.

O `bun run test:m6` (4 testes) só confere a **estrutura**. A qualidade é com você: quando terminar, cole o texto no chat e eu critico como um entrevistador faria.

### Marco 7: README, CI e scripts

- [x] No `README.md`, marque os sete marcos em "What's implemented" (`- [x]`)
- [x] Escreva a seção "Security notes" (ela está com um `TODO(m7)`): pelo menos 3 pontos sobre o que **não** está resolvido, como estado em memória, ausência de rate limit e chave de assinatura sem rotação. Honestidade aqui pesa a seu favor
- [x] Releia o README inteiro e ajuste o que não corresponder ao que você construiu. Fui eu que escrevi a primeira versão; no fim, ele precisa ser seu
- [ ] Crie `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test
```

O `bun test` sobe o servidor sozinho, então o CI não precisa de um passo para isso.

**Critérios de aceite**

- [x] `bun run test:m6` (4 testes) e `bun run test:m7` (5 testes) verdes
- [ ] `bun test` completo verde, localmente e no GitHub Actions
- [x] Alguém que nunca viu o projeto consegue rodá-lo seguindo só o README
- [x] O repositório não contém segredos, `.env` nem `node_modules`

**Commits sugeridos:** `docs: architecture, threat model and decisions` e `chore: final README and CI`

**Depois de terminar, compare com:** `ARCHITECTURE.md` e `README.md` da referência.

## Quando travar

**Como ler uma falha de teste**

- Rode só o marco atual e, dentro dele, um teste por vez: `bun test test/m2-oauth.spec.ts -t "code_verifier"`
- A mensagem do `assert` diz o esperado e o recebido. Se o status veio `500`, o erro está no terminal do `bun dev`, não no do teste
- Reproduza no console: o log à direita mostra a requisição e a resposta completas, com os headers
- Compare com o contrato do marco. Na maioria das vezes o problema é um detalhe dele: um status, um header, um nome de campo
- Se o `bun test` subiu o servidor sozinho e ele não respondeu, rode `bun dev` em outro terminal para ver o erro de inicialização

**Armadilhas mais comuns**

- Marco 1: não normalizar o email antes de procurar o usuário; respostas diferentes para "usuário não existe" e "senha errada"; esquecer o `path: '/'` no `clearCookie`
- Marco 2: esquecer o `@fastify/formbody` (o corpo do `/token` chega vazio); validar o `redirect_uri` por prefixo; não queimar o `code` quando a troca falha; comparar o `code_challenge` em base64 comum em vez de base64url
- Marco 3: `issuer` com barra final em um lugar e sem em outro; email como `sub`; chave privada no JWKS
- Marco 4: buscar a fatura só pelo id, sem conferir a organização; responder `403` onde o contrato pede `404`; checar a permissão depois de validar o corpo (a referência devolve `403` antes de `400` em roles)
- Marco 5: checar o step-up antes da permissão; calcular o contador TOTP em milissegundos em vez de janelas de 30 s; esquecer a janela de ±1

**Regra de tempo:** se um único teste consumir mais de 45 minutos, pare. Anote o que já tentou, passe para o próximo teste e volte depois. Você escolheu ver a solução só no fim de cada marco, e este guia respeita isso. Se decidir que quer uma dica pontual, peça no chat; a decisão é sua.

**Depois de terminar um marco**

1. `bun run test:mN` verde
2. Marque o marco no README e faça o commit sugerido
3. Só agora abra o arquivo daquele marco na referência e compare as decisões. O objetivo não é ficar igual: é descobrir o que você não considerou
4. Anote a diferença mais interessante: ela vira um item de "Decisions and trade-offs" no Marco 6

**Avisos sobre a referência**

- As rotas dela são funções independentes de framework (`src/lib/http.ts`), servidas por dois adaptadores: Fastify (`src/server.ts`, o padrão) e `Bun.serve` (`src/server.bun.ts`). Os 79 testes, com os bônus, passaram contra os dois; o Fastify foi validado no seu Mac, com Fastify 5.12 e Bun 1.3.
- Por isso ela tem um formato diferente do seu código, em que você registra as rotas direto no Fastify. Compare as **decisões** (o que é checado, em que ordem, o que é guardado), não o encanamento.
- Ela assina o JWT à mão e usa tokens de acesso opacos. Usar `jose` ou outra organização de pastas não está errado: os testes não dependem disso.
