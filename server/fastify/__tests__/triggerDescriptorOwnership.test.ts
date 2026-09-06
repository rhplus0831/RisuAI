import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

function typeDeclarations(file: string): Map<string, string> {
  const text = source(file)
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return new Map(
    sourceFile.statements.flatMap((node) => {
      if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) return []
      return [[node.name.text, printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)] as const]
    }),
  )
}

describe('trigger descriptor server type ownership', () => {
  it('keeps every bounded Fastify consumer behind the server owner', () => {
    const consumers = [
      'server/fastify/src/prompt/luaRuntime.ts',
      'server/fastify/src/prompt/modules.ts',
      'server/fastify/src/prompt/triggerDataEffects.ts',
      'server/fastify/src/prompt/triggers.ts',
      'server/fastify/src/prompt/triggerSource.ts',
      'server/fastify/__tests__/triggers.test.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer)).not.toMatch(/from\s+['"][^'"]*src\/ts\/process\/triggers/)
    }
  })

  it('keeps the complete server mirror aligned with browser descriptors', () => {
    const browser = typeDeclarations('src/ts/process/triggers.ts')
    const server = typeDeclarations('server/fastify/src/prompt/triggerDescriptors.ts')
    const mirrored = [...server].filter(([name]) => !name.startsWith('Server'))

    expect(mirrored.length).toBeGreaterThan(100)
    for (const [name, declaration] of mirrored) {
      expect(browser.get(name), name).toBe(declaration)
    }
  })
})
