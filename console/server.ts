// Dev console for tiny-idp: a single page served on http://localhost:4000.
//
// It plays two roles at once:
//   1. the OAuth client application ("demo-client"), whose redirect URI is
//      http://localhost:4000/callback;
//   2. a control panel to exercise every endpoint by hand and watch the HTTP traffic.
//
// Requests from the page go to /api/*, which this server forwards to the identity provider.
// Going through a same-origin proxy means the IdP needs no CORS configuration, and the `sid`
// cookie set by the IdP is stored for `localhost`, so it is also sent when the browser
// navigates to the IdP's /authorize endpoint.
//
// This is a development tool. It is not part of the identity provider and must never be deployed.

const PORT = Number(process.env.CONSOLE_PORT ?? 4000)
const IDP = (process.env.IDP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const page = Bun.file(new URL('./index.html', import.meta.url))

// Headers that describe the upstream connection, not the payload.
const HOP_BY_HOP = ['connection', 'content-encoding', 'content-length', 'transfer-encoding', 'host']

function forwardable(headers: Headers) {
  const out = new Headers(headers)
  for (const name of HOP_BY_HOP) out.delete(name)
  return out
}

function redactCookie(cookie: string) {
  const [pair = '', ...attrs] = cookie.split(';')
  const i = pair.indexOf('=')
  const value = pair.slice(i + 1)
  const shown = value ? `${value.slice(0, 6)}...(${value.length} chars)` : ''
  return [`${pair.slice(0, i)}=${shown}`, ...attrs].join(';')
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/config') return Response.json({ idp: IDP })

    if (url.pathname.startsWith('/api/')) {
      const target = IDP + url.pathname.slice('/api'.length) + url.search
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
      try {
        const upstream = await fetch(target, {
          method: request.method,
          headers: forwardable(request.headers),
          body: hasBody ? await request.arrayBuffer() : undefined,
          redirect: 'manual',
        })
        const headers = forwardable(upstream.headers)
        // Page scripts cannot read Set-Cookie. Mirror it (value redacted) so the console can
        // show which attributes the IdP set: HttpOnly, SameSite, Secure, Max-Age...
        const cookies = upstream.headers.getSetCookie().map(redactCookie)
        if (cookies.length) headers.set('x-console-set-cookie', cookies.join(' | '))
        return new Response(upstream.body, { status: upstream.status, headers })
      } catch {
        return Response.json(
          { error: 'idp_unreachable', error_description: `nothing is listening on ${IDP}` },
          { status: 502 },
        )
      }
    }

    if (url.pathname === '/' || url.pathname === '/callback') {
      return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    return new Response('not found', { status: 404 })
  },
})

console.log(`tiny-idp console on http://localhost:${PORT}  (identity provider: ${IDP})`)
