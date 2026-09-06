import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'svelte/compiler'
import ts from 'typescript'

/** Parse scripts as code so comments and template text cannot satisfy dependency rules. */
export function parseSource(file: string, source: string): ts.SourceFile {
  if (file.endsWith('.svelte')) {
    const component = parse(source, { filename: file, modern: true })
    source = [component.module, component.instance]
      .flatMap((script) => {
        if (!script) return []
        // Svelte supplies offsets on ESTree programs, but ESTree's Program type omits them.
        const { start, end } = script.content as typeof script.content & { start: number; end: number }
        if (typeof start !== 'number' || typeof end !== 'number') throw new Error(`Missing script offsets in ${file}`)
        return [source.slice(start, end)]
      })
      .join('\n')
  }
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

export function moduleSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = []
  const record = (node: ts.Node | undefined): void => {
    specifiers.push(node && ts.isStringLiteralLike(node) ? node.text : '<non-literal module>')
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) record(node.moduleSpecifier)
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) record(node.moduleSpecifier)
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node.moduleReference.expression)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      record(node.argument.literal)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

const moduleCaches = new Map<string, ts.ModuleResolutionCache>()

export function resolveModule(repoRoot: string, importer: string, specifier: string): string | undefined {
  const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: repoRoot, resolveJsonModule: true }
  if (!moduleCaches.has(repoRoot)) {
    moduleCaches.set(
      repoRoot,
      ts.createModuleResolutionCache(repoRoot, (file) => file, options),
    )
  }
  const resolved = ts.resolveModuleName(
    specifier,
    path.resolve(repoRoot, importer),
    options,
    ts.sys,
    moduleCaches.get(repoRoot),
  ).resolvedModule?.resolvedFileName
  return resolved ? fs.realpathSync(resolved) : undefined
}

export function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function exportedInterfaceProperties(source: ts.SourceFile, name: string): Record<string, string> | undefined {
  const declaration = source.statements.find(
    (node): node is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(node) &&
      node.name.text === name &&
      !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  )
  if (!declaration) return undefined
  const printer = ts.createPrinter()
  const properties = (members: ts.NodeArray<ts.TypeElement>, prefix = ''): Array<[string, string]> =>
    members.filter(ts.isPropertySignature).flatMap((member) => {
      const key = `${prefix}${member.name.getText(source)}${member.questionToken ? '?' : ''}`
      if (member.type && ts.isTypeLiteralNode(member.type)) return properties(member.type.members, `${key}.`)
      return [[key, member.type ? printer.printNode(ts.EmitHint.Unspecified, member.type, source) : 'any']]
    })
  return Object.fromEntries(properties(declaration.members))
}
