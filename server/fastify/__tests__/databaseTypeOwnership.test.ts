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

  it('exports finite selected database and row contracts without aggregate escape types', () => {
    const ownerPath = path.join(repoRoot, 'server/fastify/src/prompt/serverTypes.ts')
    const configPath = path.join(repoRoot, 'server/fastify/tsconfig.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
    const program = ts.createProgram([ownerPath], parsed.options)
    const checker = program.getTypeChecker()
    const owner = program.getSourceFile(ownerPath)!
    const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(owner)!)
    const contracts = {
      GenerationSettings: ['temperature', 'customModels', 'promptTemplate'],
      FastifyDatabase: ['characters', 'temperature'],
      FastifyChat: ['message', 'generationSettings'],
      FastifyMessage: ['role', 'data'],
      FastifyCharacter: ['chaId', 'chats'],
      FastifyLoreBook: ['content', 'mode'],
      FastifyCustomScript: ['in', 'out'],
      FastifyMessagePresetInfo: ['promptText', 'promptName'],
    }

    for (const [name, requiredProperties] of Object.entries(contracts)) {
      const symbol = exports.find((entry) => entry.name === name)
      expect(symbol, name).toBeDefined()
      const contract = checker.getDeclaredTypeOfSymbol(symbol!)
      expect(contract.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never), name).toBe(0)
      expect(checker.getIndexInfosOfType(contract), name).toEqual([])
      const properties = checker.getPropertiesOfType(contract)
      expect(
        properties.map((property) => property.name),
        name,
      ).toEqual(expect.arrayContaining(requiredProperties))
      for (const property of properties) {
        const value = checker.getTypeOfSymbolAtLocation(property, owner)
        expect(value.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown), `${name}.${property.name}`).toBe(0)
      }
    }
  })
})
