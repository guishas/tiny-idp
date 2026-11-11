// MARCO 7 — repositório pronto para ser visto por um entrevistador (verificação estrutural).
//
// O README.md já existe desde o primeiro commit. Para fechar o marco 7:
//   - na seção "What's implemented", todos os marcos estão marcados ([x]) — nenhum "- [ ]" sobrando
//   - a seção "Security notes" foi escrita por você: pelo menos 3 itens e nenhum marcador TODO(m7)
//   - existe .github/workflows/ci.yml rodando `bun test`
//   - package.json mantém os scripts "dev", "start" e "test"
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'bun:test'

const root =
  process.env.REPO_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => {
  const full = path.join(root, p)
  assert.ok(existsSync(full), `falta o arquivo ${p}`)
  return readFileSync(full, 'utf8')
}
const section = (md: string, title: string) =>
  md.match(new RegExp(`^##\\s+${title}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im'))?.[1]

test('README: todos os marcos marcados como concluídos', () => {
  const body = section(read('README.md'), "What's implemented")
  assert.ok(body, 'faltou a seção "What\'s implemented"')
  assert.ok(/- \[x\]/i.test(body), 'marque os marcos concluídos com "- [x]"')
  assert.ok(!/- \[ \]/.test(body), 'ainda há marcos desmarcados ("- [ ]")')
})

test('README: "Security notes" escrita por você (3 itens ou mais, sem TODO)', () => {
  const md = read('README.md')
  assert.ok(!md.includes('TODO(m7)'), 'remova os marcadores TODO(m7) do README')
  const body = section(md, 'Security notes')
  assert.ok(body, 'faltou a seção "Security notes"')
  const items = body.split('\n').filter((l) => /^\s*([-*]|\d+\.)\s+\S/.test(l))
  assert.ok(items.length >= 3, `liste pelo menos 3 pontos (achei ${items.length})`)
})

test('README mantém as seções "How to run" e "Out of scope"', () => {
  const md = read('README.md')
  assert.match(md, /^##\s+How to run/im)
  assert.match(md, /^##\s+Out of scope/im)
})

test('CI roda os testes com bun', () => {
  const yml = read('.github/workflows/ci.yml')
  assert.match(yml, /\bon:/)
  assert.match(yml, /bun (run )?test/)
})

test('package.json tem os scripts dev, start e test', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const s of ['dev', 'start', 'test']) assert.ok(pkg.scripts?.[s], `script "${s}" ausente`)
})
