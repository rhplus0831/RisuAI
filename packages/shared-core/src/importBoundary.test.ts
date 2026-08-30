import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.dirname(fileURLToPath(import.meta.url))

function discoverRuntimeFiles(root: string, directory = root): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...discoverRuntimeFiles(root, absolutePath))
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path.relative(root, absolutePath).replaceAll(path.sep, '/'))
    }
  }
  return files.sort()
}

function moduleSpecifiers(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const specifiers: string[] = []
  const record = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) record(node.moduleSpecifier)
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamicImport || requireCall) record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function auditImportBoundary(root: string): { runtimeFiles: string[]; violations: string[] } {
  const runtimeFiles = discoverRuntimeFiles(root)
  const violations: string[] = []
  for (const file of runtimeFiles) {
    const absolutePath = path.join(root, file)
    for (const specifier of moduleSpecifiers(file, fs.readFileSync(absolutePath, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        violations.push(`${file}: ${specifier}`)
        continue
      }
      const target = path.resolve(path.dirname(absolutePath), specifier)
      const relativeTarget = path.relative(root, target)
      if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
        violations.push(`${file}: ${specifier}`)
      }
    }
  }
  return { runtimeFiles, violations }
}

describe('@risuai/shared-core import boundary', () => {
  it('keeps every runtime module dependency-free and inside shared core', () => {
    expect(auditImportBoundary(sourceRoot)).toEqual({
      runtimeFiles: [
        'agentPresetOutputReferences.ts',
        'chatDisplayTailCount.ts',
        'chatLoadPages.ts',
        'chatMLRows.ts',
        'chatPage.ts',
        'historySlots.ts',
        'index.ts',
        'inlayTokens.ts',
        'internalReasoning.ts',
        'legacyOpenAIModelAliases.ts',
        'punctuation.ts',
        'regexOutputSizeLimit.ts',
      ],
      violations: [],
    })
  })

  it('rejects bare, nested, dynamic, require, and package-escape imports', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-shared-core-import-boundary-'))
    try {
      fs.mkdirSync(path.join(fixtureRoot, 'nested'))
      fs.writeFileSync(
        path.join(fixtureRoot, 'index.ts'),
        `
          import { writable } from 'svelte/store'
          const dynamicModule = import('node:path')
        `,
      )
      fs.writeFileSync(
        path.join(fixtureRoot, 'nested', 'runtime.ts'),
        `
          import fs = require('node:fs')
          const platform = require('node:os')
          export { escaped } from '../../outside.js'
        `,
      )
      expect(auditImportBoundary(fixtureRoot)).toEqual({
        runtimeFiles: ['index.ts', 'nested/runtime.ts'],
        violations: [
          'index.ts: svelte/store',
          'index.ts: node:path',
          'nested/runtime.ts: node:fs',
          'nested/runtime.ts: node:os',
          'nested/runtime.ts: ../../outside.js',
        ],
      })
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
