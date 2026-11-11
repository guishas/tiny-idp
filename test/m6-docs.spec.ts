// MARCO 6 — documentação de arquitetura e modelo de ameaças (verificação estrutural dos arquivos).
// Estes testes só conferem que o documento existe e tem as partes pedidas; a QUALIDADE do conteúdo é com você
// (releia o guia do marco 6 e peça a um colega, ou a mim, para criticar).
//
// Precisa existir ARCHITECTURE.md na raiz do repositório com:
//   - um diagrama Mermaid (bloco ```mermaid)
//   - seção "Components" (ou "Componentes")
//   - seção "Threat model" (ou "Modelo de ameaças") com uma tabela de pelo menos 6 ameaças e 3 colunas
//   - seção "Decisions and trade-offs" (ou "Decisões e trade-offs") com pelo menos 3 itens
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root =
  process.env.REPO_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const archPath = path.join(root, 'ARCHITECTURE.md')

function load() {
  assert.ok(existsSync(archPath), 'crie ARCHITECTURE.md na raiz do repositório')
  return readFileSync(archPath, 'utf8')
}

const section = (md: string, names: string[]) => {
  const re = new RegExp(
    `^##\\s+(?:${names.join('|')})\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`,
    'im',
  )
  return md.match(re)?.[1]
}

test('ARCHITECTURE.md tem um diagrama Mermaid', () => {
  assert.match(load(), /```mermaid\n[\s\S]+?```/)
})

test('ARCHITECTURE.md tem a seção Components/Componentes', () => {
  const body = section(load(), ['Components', 'Componentes'])
  assert.ok(body && body.trim().length > 80, 'descreva os componentes (mais de uma linha)')
})

test('ARCHITECTURE.md tem modelo de ameaças com pelo menos 6 linhas e 3 colunas', () => {
  const body = section(load(), ['Threat model', 'Modelo de amea[çc]as'])
  assert.ok(body, 'faltou a seção "Threat model"')
  const rows = body
    .split('\n')
    .filter((l: string) => l.trim().startsWith('|'))
    .filter((l: string) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)) // tira a linha separadora
  assert.ok(
    rows.length >= 7,
    `precisa de cabeçalho + 6 ameaças (achei ${rows.length} linhas de tabela)`,
  )
  const cols = (rows[0] ?? '').split('|').filter((c) => c.trim()).length
  assert.ok(cols >= 3, 'use ao menos 3 colunas: ameaça, mitigação, onde está no código')
})

test('ARCHITECTURE.md tem decisões e trade-offs (3 itens ou mais)', () => {
  const body = section(load(), ['Decisions and trade-offs', 'Decis[õo]es e trade-offs'])
  assert.ok(body, 'faltou a seção "Decisions and trade-offs"')
  const items = body.split('\n').filter((l: string) => /^\s*([-*]|\d+\.)\s+\S/.test(l))
  assert.ok(items.length >= 3, `liste pelo menos 3 decisões (achei ${items.length})`)
})
