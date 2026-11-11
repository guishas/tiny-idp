# tiny-idp

A small identity provider, built from scratch to learn authentication and authorization from the
inside: sessions, OAuth 2.0 with PKCE, OpenID Connect, multi-tenant roles with delegation, TOTP
step-up authentication and an audit log.

It is a learning project, not a product. The point is to implement by hand the things that are
normally hidden behind a vendor SDK, and to be able to explain every security decision in it.

> **Status: work in progress.** The server is implemented one milestone at a time, and each
> milestone is done when its acceptance tests pass. The checklist in
> [What's implemented](#whats-implemented) is the source of truth for what exists today.

## Table of contents

- [Why this exists](#why-this-exists)
- [What it does](#what-it-does)
- [How the project is organized](#how-the-project-is-organized)
- [Stack](#stack)
- [How to run](#how-to-run)
- [The dev console](#the-dev-console)
- [The acceptance tests](#the-acceptance-tests)
- [What's implemented](#whats-implemented)
- [API overview](#api-overview)
- [Out of scope](#out-of-scope)
- [Security notes](#security-notes)

## Why this exists

Integrating "Login with X" teaches the client side of identity. This project is the other side:
being the server that issues the tokens, decides who may do what, asks for a second factor when
an action is sensitive, and records what happened.

Each milestone targets one question an identity and access management engineer has to be able to
answer:

| # | Milestone | The question it answers |
| - | --------- | ----------------------- |
| 1 | Registration, login, sessions | How do you store passwords and keep someone logged in safely? |
| 2 | OAuth 2.0 authorization server | How does an app get access on a user's behalf without seeing the password? |
| 3 | OpenID Connect | How does an app learn *who* logged in, and why can it trust that answer? |
| 4 | Organizations, custom roles, delegation | Who is allowed to do what, in which tenant, and on whose behalf? |
| 5 | TOTP, step-up authentication, audit log | When is a login not enough, and how do you prove what happened later? |
| 6 | Architecture and threat model | What can go wrong, and where exactly is each mitigation? |
| 7 | Presentable repository | Can a stranger run it and understand it in a few minutes? |

## What it does

When complete, tiny-idp is a single HTTP service that:

- **Authenticates users** with a password stored as a slow, salted hash (argon2id), and keeps
  them logged in with a server-side session behind an `HttpOnly` cookie.
- **Acts as an OAuth 2.0 authorization server** for a public client: Authorization Code flow with
  mandatory PKCE (S256 only), exact-match redirect URIs, scopes, single-use codes, and refresh
  tokens with rotation. Reusing a refresh token revokes the whole token family.
- **Acts as an OpenID Connect provider**: discovery document, JWKS, RS256-signed ID tokens with
  `nonce`, and a `/userinfo` endpoint.
- **Authorizes actions in a multi-tenant model**: organizations, customer-defined roles built from
  a fixed permission catalog, a single deny-by-default `can()` function, protection against
  privilege escalation, and time-boxed delegation that does not chain.
- **Requires step-up authentication** for sensitive actions: approving a large invoice needs a
  recent TOTP verification, signalled to the client with the RFC 9470 challenge.
- **Keeps an append-only audit log** that records who did what, to what, on whose behalf, and
  whether it was allowed, without ever storing secrets.

The business domain is deliberately boring (organizations that create and approve invoices) so
that the interesting part is the access control around it.

## How the project is organized

```
src/                 the identity provider (written by hand, milestone by milestone)
  app.ts             Fastify instance and route registration
  server.ts          entry point
  env.ts             environment variables, validated with Zod
test/                acceptance tests: the specification of each milestone
  m1-auth.spec.ts    ... m5-mfa-audit.spec.ts   black-box HTTP tests
  m6-docs.spec.ts    m7-repo.spec.ts            structural checks on the docs and the repo
  helpers.ts         cookie jar, PKCE, JWT verification and TOTP used by the tests
  setup.ts           starts the server for a test run if it is not already running
console/             dev console (see below); a development tool, not part of the IdP
```

The project is **spec-first**. The acceptance tests in `test/` describe the HTTP contract of every
milestone (the contract is written at the top of each spec file), and the server is written to
satisfy them. The tests are black-box: they only speak HTTP, so they do not depend on how the
server is structured internally.

For transparency: the acceptance tests and the dev console were prepared up front with AI
assistance, as the specification and tooling for the exercise. The server in `src/` is the
exercise itself and is written by hand.

## Stack

- [Bun](https://bun.sh) as runtime, package manager and test runner
- TypeScript (strict)
- [Fastify](https://fastify.dev) for HTTP and [Zod](https://zod.dev) for input validation
- [Biome](https://biomejs.dev) for linting and formatting
- Storage is in memory on purpose (see [Out of scope](#out-of-scope))

## How to run

Requirements: Bun 1.2 or newer.

```bash
bun install
cp .env.example .env     # optional: the defaults work

bun dev                  # identity provider on http://localhost:3000 (restarts on change)
bun run console          # dev console on http://localhost:4000 (in a second terminal)
```

Run the acceptance tests:

```bash
bun test                 # everything
bun run test:m1          # one milestone (m1 ... m7)
bun run test:api         # milestones 1 to 5 (the HTTP API)
bun run test:bonus       # also runs the optional "bonus" tests
```

`bun test` uses the server already running on port 3000. If there is none, it starts
`src/server.ts` for the duration of the run and stops it afterwards. To test a server somewhere
else, set `BASE_URL=http://host:port`.

Other scripts: `bun run lint`, `bun run lint:fix`, `bun run typecheck`.

## The dev console

`bun run console` serves a single page on `http://localhost:4000` that works as a control panel
for the identity provider:

- **Session**: register, log in, log out, switch between test users, try failed logins.
- **OAuth**: the console *is* the OAuth client (`demo-client`, redirect URI
  `http://localhost:4000/callback`). It generates the PKCE verifier and challenge, sends the
  browser to `/authorize`, receives the callback, checks `state`, exchanges the code, refreshes
  tokens, and has buttons for the attacks the server must resist (wrong verifier, code reuse,
  refresh token replay).
- **OIDC**: fetches discovery and JWKS, decodes the ID token and validates it in the browser
  (signature, `iss`, `aud`, `exp`, `nonce`).
- **Orgs & roles**: create organizations, roles, members, invoices and delegations; approve
  invoices and see the step-up challenge when one is required.
- **MFA & audit**: enroll TOTP (the console doubles as the authenticator app and shows the
  current code), perform step-up, and read the audit trail.
- **HTTP log**: every request and response, with headers and bodies.

The page talks to the IdP through a same-origin proxy (`/api/*`), so the IdP needs no CORS setup.
The console keeps test credentials and TOTP secrets in the browser's local storage so that
switching users takes one click. That is acceptable for throwaway local accounts and for nothing
else: it is a development tool and must never be deployed.

## The acceptance tests

| Script | File | What it covers |
| ------ | ---- | -------------- |
| `test:m1` | `test/m1-auth.spec.ts` | registration rules, login, uniform login errors, session cookie attributes, logout, session fixation |
| `test:m2` | `test/m2-oauth.spec.ts` | `/authorize` validation order, exact redirect URI match, mandatory PKCE, `state`, single-use codes, scopes, refresh rotation and family revocation |
| `test:m3` | `test/m3-oidc.spec.ts` | discovery document, JWKS without private material, ID token signature and claims, stable `sub`, `/userinfo` |
| `test:m4` | `test/m4-authz.spec.ts` | tenant isolation, custom roles, privilege-escalation checks, filtered listings, 404 instead of 403 where existence must not leak, delegation and its expiry and revocation |
| `test:m5` | `test/m5-mfa-audit.spec.ts` | TOTP enrollment, step-up, the RFC 9470 challenge, permission-before-step-up ordering, audit events, no secrets in the audit log |
| `test:m6` | `test/m6-docs.spec.ts` | `ARCHITECTURE.md` exists with a diagram, components, a threat model and decisions |
| `test:m7` | `test/m7-repo.spec.ts` | this README is complete, CI exists, scripts are in place |

Tests marked `[bônus]` are optional hardening checks and are skipped unless `BONUS=1` is set.
Test names and messages are in Portuguese.

## What's implemented

- [ ] **Milestone 1** — registration, login and server-side sessions
- [ ] **Milestone 2** — OAuth 2.0 Authorization Code + PKCE, scopes, refresh token rotation
- [ ] **Milestone 3** — OpenID Connect: discovery, JWKS, ID token, userinfo
- [ ] **Milestone 4** — organizations, custom roles, `can()`, delegation
- [ ] **Milestone 5** — TOTP, step-up authentication (RFC 9470), audit log
- [ ] **Milestone 6** — `ARCHITECTURE.md`: diagram, threat model, decisions and trade-offs
- [ ] **Milestone 7** — final README, CI

## API overview

The full contract of each endpoint (inputs, status codes, error cases) is at the top of the
corresponding spec file in `test/`.

| Area | Endpoints |
| ---- | --------- |
| Session | `POST /register`, `POST /login`, `GET /me`, `POST /logout` |
| OAuth 2.0 | `GET /authorize`, `POST /token`, `GET /api/profile` (protected resource) |
| OpenID Connect | `GET /.well-known/openid-configuration`, `GET /jwks.json`, `GET /userinfo` |
| Organizations | `POST /orgs`, `GET /orgs/:orgId` |
| Roles and members | `POST /orgs/:orgId/roles`, `POST /orgs/:orgId/members`, `PUT /orgs/:orgId/members/:userId` |
| Invoices | `POST /orgs/:orgId/invoices`, `GET /orgs/:orgId/invoices`, `GET /orgs/:orgId/invoices/:id`, `POST /orgs/:orgId/invoices/:id/approve` |
| Delegation | `POST /orgs/:orgId/delegations`, `DELETE /orgs/:orgId/delegations/:id` |
| MFA and step-up | `POST /mfa/totp/enroll`, `POST /mfa/totp/confirm`, `POST /stepup` |
| Audit | `GET /orgs/:orgId/audit` |

Permission catalog: `invoice:create`, `invoice:read`, `invoice:read:own`, `invoice:approve`,
`role:manage`, `member:manage`, `delegation:manage`, `audit:read`.

The pre-registered OAuth client is public (no secret): `client_id=demo-client`,
`redirect_uri=http://localhost:4000/callback`, scopes `profile`, `email`, `openid`.

## Out of scope

Left out on purpose, to keep the project small enough to finish and explain:

- **Persistence.** State lives in memory and is lost on restart.
- **Client registration.** There is exactly one OAuth client, registered in code.
- **A consent screen and a hosted login page.** Consent is automatic; login is an API call.
- **Confidential clients and other grant types** (client credentials, device flow).
- **Signing key rotation.** One RS256 key is generated at startup.
- **Rate limiting and account lockout.**
- **Email verification and password reset.**
- **SAML, SCIM and passkeys as a tested feature.** WebAuthn is only explored manually.

## Security notes

TODO(m7): to be written in milestone 7, once everything is implemented. This section will list,
honestly, what is and is not handled: known gaps, and what would have to change before anything
like this could face real users.
