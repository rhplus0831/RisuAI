import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('BardWiki server type ownership', () => {
  it('keeps BardWiki production consumers behind Fastify-owned inputs', () => {
    const consumers = [
      'server/fastify/src/bardWikiApplyTurnHandler.ts',
      'server/fastify/src/bardWikiCanonicalModel.ts',
      'server/fastify/src/bardWikiEventModel.ts',
      'server/fastify/src/bardWikiRebuildHandler.ts',
      'server/fastify/src/prompt/bardWiki.ts',
      'server/fastify/src/bardWikiTypes.ts',
    ]

    for (const consumer of consumers) {
      const contents = source(consumer)
      expect(contents).not.toContain('src/ts/storage/database.svelte')
      expect(contents).not.toContain('src/ts/process/index.svelte')
    }

    const owner = ts.createSourceFile(
      'bardWikiTypes.ts',
      source('server/fastify/src/bardWikiTypes.ts'),
      ts.ScriptTarget.Latest,
      true,
    )
    const inputImport = owner.statements.find(
      (node): node is ts.ImportDeclaration =>
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === './prompt/serverTypes.js',
    )
    expect(inputImport?.importClause?.isTypeOnly).toBe(true)
    const bindings = inputImport?.importClause?.namedBindings
    expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map((item) => item.name.text)).toEqual([
      'ProviderGenerationSettings',
    ])
    const database = owner.statements.find(
      (node): node is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(node) && node.name.text === 'BardWikiGenerationDatabase',
    )
    expect(database?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true)
    expect(database && ts.isTypeReferenceNode(database.type) && database.type.typeName.getText(owner)).toBe(
      'ProviderGenerationSettings',
    )
  })
})
