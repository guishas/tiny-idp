# tiny-idp

A small identity provider built from scratch to learn authentication and authorization from the
inside. It is a **learning project, not a product**: the goal is to implement by hand what is
normally hidden behind a vendor SDK, and to be able to explain every security decision.

The server implements, milestone by milestone: sessions, OAuth 2.0 (Authorization Code + PKCE),
OpenID Connect, multi-tenant roles with delegation, TOTP step-up (RFC 9470) and an audit log. The
business domain is deliberately boring (organizations that create and approve invoices) so the
access control is the interesting part.

## Stack

- **Bun** (1.2+) as runtime, package manager and test runner
- **TypeScript**, strict, with `noUncheckedIndexedAccess`; path alias `@/*` -> `src/*`
- **Fastify 5** for HTTP, **Zod 4** for input validation
- **Biome** for lint and format: single quotes, no semicolons, 100 columns, trailing commas,
  2-space indent
- **No database**: all state lives in memory (`Map`) on purpose. Password hashing uses
  `Bun.password` (argon2id, built in)

## Commands

```bash
bun dev                 # IdP on http://localhost:3000, restarts on change
bun run console         # dev console on http://localhost:4000
bun test                # all acceptance tests
bun run test:m1         # one milestone (m1 ... m7)
bun run test:api        # milestones 1-5 (the HTTP API)
bun run test:bonus      # also runs the optional [bônus] tests (BONUS=1)
bun test -t "<text>"    # only tests whose name contains the text
bun run lint            # Biome check   (lint:fix to apply)
bun run typecheck       # tsc --noEmit
```

Config is via env (`.env.example`): `PORT` (default 3000), `ISSUER` (defaults to
`http://localhost:$PORT`, no trailing slash, used as the OIDC issuer), `NODE_ENV`.

## Repository layout

```
src/        the identity provider (the exercise)
  app.ts      Fastify instance, request id, error handlers and route registration
  server.ts   entry point, listens on env.PORT
  env.ts      env vars validated with Zod
  store.ts    the in-memory Maps and their types
  auth/       passwords (argon2id), sessions, TOTP attempt limit
  oauth/      clients, PKCE, authorization codes, token families, grants
  oidc/       signing key, JWT signing, ID token
  authz/      permission catalog, can(), step-up policy
  audit/      the single audit() writer
  lib/        random tokens, base32, TOTP
  http/       HttpError, error handler, validation, request id, org context and controllers/
              {api,auth,mfa,oauth,oidc,orgs}
test/       acceptance tests = the specification of each milestone
  m1-auth ... m5-mfa-audit .spec.ts   black-box HTTP tests; the API contract is in the header
  m6-docs / m7-repo .spec.ts          structural checks (ARCHITECTURE.md, README, scripts)
  helpers.ts  cookie-jar Session, PKCE, JWT verify, TOTP   (do not edit)
  setup.ts    starts src/server.ts if nothing listens on BASE_URL (do not edit)
console/    dev console (server.ts + index.html); NOT part of the IdP
docs/GUIDE.md   step-by-step guide per milestone, in Portuguese
ARCHITECTURE.md diagrams, components, threat model, decisions and trade-offs
README.md       public description + milestone checklist (source of truth for progress)
```

## How it works

**Spec-first.** The tests in `test/` are the HTTP contract. They are black-box: they only speak
HTTP to `BASE_URL` (default `http://localhost:3000`) and import nothing from `src/`, so the
internal structure is free. If a server is already on that port the tests use it; otherwise
`bun test` boots `src/server.ts` for the run and stops it after. Route names and payload shapes
are the contract; changing one breaks tests on purpose. Each spec file also lists manual checks
that cannot be tested from outside (e.g. password stored as argon2id, `Secure` cookie when
`NODE_ENV=production`).

**Milestones** (each is done when its tests pass; then tick it in the README and commit):

| # | Scope | Spec |
| - | ----- | ---- |
| 1 | `POST /register`, `POST /login`, `GET /me`, `POST /logout`; server-side sessions, `sid` cookie | `m1-auth` |
| 2 | OAuth 2.0 `GET /authorize`, `POST /token`, `GET /api/profile`; PKCE S256 only, exact redirect URI, single-use codes, refresh rotation + family revocation | `m2-oauth` |
| 3 | OIDC discovery, `/jwks.json`, RS256 ID token with `nonce`, `/userinfo` | `m3-oidc` |
| 4 | Orgs, custom roles, members, invoices, delegation; one deny-by-default `can()` | `m4-authz` |
| 5 | TOTP enroll/confirm, `POST /stepup`, RFC 9470 challenge, audit log | `m5-mfa-audit` |
| 6 | `ARCHITECTURE.md`: diagram, components, threat model, decisions | `m6-docs` |
| 7 | Final README (no CI, by choice) | `m7-repo` |

Permission catalog (M4): `invoice:create`, `invoice:read`, `invoice:read:own`, `invoice:approve`,
`role:manage`, `member:manage`, `delegation:manage`, `audit:read`.

**Dev console** (`console/`): a single page on port 4000 that is both the OAuth client
(`demo-client`, redirect URI `http://localhost:4000/callback`, which is hardcoded in the tests)
and a control panel with one tab per milestone plus an HTTP log. The page talks to the IdP via a
same-origin proxy (`/api/*` -> `IDP_URL`, default `http://localhost:3000`), so the IdP needs no
CORS. The proxy mirrors `Set-Cookie` (value redacted) as `x-console-set-cookie`. It keeps test
credentials and TOTP secrets in localStorage, which is acceptable for throwaway local accounts
only: it is a dev tool and must never be deployed. Red buttons are attacks the server must
refuse. Until a route exists its button shows `404`, which is expected.

## Conventions

- Validate every request body with a Zod schema (`safeParse`); on failure respond `400`.
- Errors: a `HttpError(status, code)` class plus `app.setErrorHandler` that returns
  `{ error: code }`; unknown errors become `500 { error: 'server_error' }` with detail only in the
  log. Preserve `error.statusCode` so malformed JSON stays `400`, never `500`.
- Never return or log passwords, hashes, TOTP secrets or tokens; the audit log never stores secrets.
- Use `localhost`, not `127.0.0.1`: the `sid` cookie must be shared between ports 3000 and 4000.
- Fastify rejects `content-type: application/json` with an empty body with `400` before the route
  runs (watch for this when using `curl -X POST`).
- Commit messages are English conventional commits (e.g. `feat: registration, login and
  server-side sessions`).

## Working rules

- **Do not edit `test/` or `console/`.** They are the spec and the tooling. If a test looks
  wrong, say why instead of changing it (fixing types, imports or lint is fine).
- Claude may implement milestone code in `src/` when asked. This is still a learning exercise, so
  explain the security reasoning behind decisions (what attack a check prevents), and keep the
  code simple enough for the owner to explain.
- Test names, spec headers and `docs/GUIDE.md` are in Portuguese; code, comments,
  README and commits are in English.
- Storage stays in memory; do not add a database or other heavy dependencies without asking.
- Keep Biome and `tsc` clean before calling a milestone done.
