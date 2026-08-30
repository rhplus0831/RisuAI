import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const serverRoots = ['server/fastify/src', 'server/fastify/__tests__', 'server/fastify/browser-smoke']

function typescriptFiles(root: string): string[] {
  const absolute = path.join(repoRoot, root)
  if (!fs.existsSync(absolute)) return []
  return fs.readdirSync(absolute, { recursive: true, withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !/\.(?:cts|mts|ts|tsx)$/.test(entry.name)) return []
    return [path.join(entry.parentPath, entry.name)]
  })
}

function importedSpecifiers(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  return source.statements.flatMap((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return []
    return [node.moduleSpecifier.text]
  })
}

describe('Fastify application-model type ownership', () => {
  it('has no production, server-test, or browser-smoke import of the browser aggregate database module', () => {
    const offenders = serverRoots.flatMap(typescriptFiles).flatMap((file) =>
      importedSpecifiers(file)
        .filter((specifier) => specifier.includes('src/ts/storage/database.svelte'))
        .map((specifier) => `${path.relative(repoRoot, file)} -> ${specifier}`),
    )

    expect(offenders).toEqual([])
  })

  it('keeps bounded row contracts structural at the Fastify boundary', () => {
    const owner = fs.readFileSync(path.join(repoRoot, 'server/fastify/src/prompt/serverTypes.ts'), 'utf8')

    for (const typeName of [
      'FastifyChat',
      'FastifyMessage',
      'FastifyCharacter',
      'FastifyLoreBook',
      'FastifyCustomScript',
      'FastifyMessagePresetInfo',
    ]) {
      expect(owner).toContain(`export interface ${typeName}`)
      expect(owner).not.toContain(`type ${typeName} = any`)
    }
    expect(owner).toContain('Fastify-owned structural views')
    expect(owner).toContain('FastifyDatabase = any')
    expect(owner).toContain('open compatibility payload')
  })
})
