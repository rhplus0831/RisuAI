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

describe('module descriptor server type ownership', () => {
  it('keeps every bounded Fastify consumer behind the server owner', () => {
    const consumers = [
      'server/fastify/src/prompt/modules.ts',
      'server/fastify/src/prompt/scripts.ts',
      'server/fastify/src/prompt/triggers.ts',
      'server/fastify/__tests__/lorebook.test.ts',
      'server/fastify/__tests__/luaRuntime.test.ts',
      'server/fastify/__tests__/modules.test.ts',
      'server/fastify/__tests__/modulesMemo.test.ts',
      'server/fastify/__tests__/triggers.test.ts',
    ]

    for (const consumer of consumers) {
      expect(source(consumer)).not.toMatch(/from\s+['"][^'"]*src\/ts\/process\/modules/)
    }
  })

  it('keeps module, regex, and lorebook records aligned with browser descriptors', () => {
    const server = typeDeclarations('server/fastify/src/prompt/moduleDescriptors.ts')
    const browserModules = typeDeclarations('src/ts/process/modules.ts')
    const browserDatabase = typeDeclarations('src/ts/storage/database.svelte.ts')

    expect(server.get('MCPModule')).toBe(browserModules.get('MCPModule'))
    expect(server.get('RisuModule')).toBe(browserModules.get('RisuModule'))
    expect(server.get('customscript')).toBe(browserDatabase.get('customscript'))
    expect(server.get('loreBook')).toBe(browserDatabase.get('loreBook'))
  })
})
