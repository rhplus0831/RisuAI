import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isPathWithinRoot,
  markdownLinesOutsideFences,
  markdownLocalLinks,
  resolveMarkdownLinkPath,
  validateMarkdownLinks,
} from './markdown-documentation.js'

const rootDocumentation = ['STRUCTURE.md', 'README.md', 'AGENTS.md', 'CLAUDE.md'] as const
const optionalLocalDocumentation = ['AGENTS.override.md'] as const
const documentationDirectories = ['docs/structure', 'src/docs', 'docs/tests'] as const
const packageDocumentation = ['packages/protocol/README.md', 'packages/shared-core/README.md'] as const
const additionalDocumentation = ['server/fastify/__tests__/README.md', 'src/ts/__tests__/README.md'] as const

export interface DocumentationIndexSpec {
  directory: string
  index: string
}

export interface LiteralPathExemption {
  document?: string
  path: string
  reason: string
}

export interface CurrentDocumentationValidationOptions {
  documentPaths?: readonly string[]
  indexSpecs?: readonly DocumentationIndexSpec[]
  literalPathExemptions?: readonly LiteralPathExemption[]
  repoRoot?: string
}

export interface CurrentDocumentationValidationResult {
  documentCount: number
  errors: string[]
  ok: boolean
}

export const currentDocumentationIndexSpecs: readonly DocumentationIndexSpec[] = [
  { index: 'docs/structure/README.md', directory: 'docs/structure' },
  { index: 'src/docs/README.md', directory: 'src/docs' },
  { index: 'docs/tests/README.md', directory: 'docs/tests' },
]

/** Intentional current-document references to paths whose absence is itself documented. */
export const currentDocumentationLiteralPathExemptions: readonly LiteralPathExemption[] = [
  {
    document: 'docs/structure/testing-and-operations.md',
    path: 'server/fastify/package.json',
    reason: 'the current root-only package layout intentionally has no nested Fastify manifest',
  },
  {
    document: 'docs/structure/generated-and-legacy.md',
    path: 'server/fastify/package.json',
    reason: 'the generated/legacy inventory explicitly documents the absent nested Fastify manifest',
  },
  {
    document: 'docs/structure/generated-and-legacy.md',
    path: 'public/functions/',
    reason: 'the legacy worker/function surface is intentionally absent',
  },
  {
    document: 'docs/structure/generated-and-legacy.md',
    path: 'public/sw.js',
    reason: 'the legacy offline service worker is intentionally absent',
  },
  {
    document: 'docs/structure/generated-and-legacy.md',
    path: 'src/lib/UI/NewGUI/',
    reason: 'the legacy UI tree is intentionally absent',
  },
  {
    document: 'docs/structure/generated-and-legacy.md',
    path: 'src/ts/sync/',
    reason: 'the retired peer-sync tree is intentionally absent',
  },
  {
    document: 'docs/structure/generated-and-legacy.md',
    path: 'src/lib/Others/Legal.svelte',
    reason: 'the retired application-wide terms component is intentionally absent',
  },
]

function directMarkdownFiles(repoRoot: string, directory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, directory)
  if (!existsSync(absoluteDirectory)) return []
  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.posix.join(directory, entry.name))
}

function packageReadmes(repoRoot: string): string[] {
  const packagesRoot = path.join(repoRoot, 'packages')
  if (!existsSync(packagesRoot)) return []
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(packagesRoot, entry.name, 'README.md')))
    .map((entry) => path.posix.join('packages', entry.name, 'README.md'))
}

export function currentDocumentationPaths(repoRoot = process.cwd()): string[] {
  return [
    ...new Set([
      ...rootDocumentation,
      ...optionalLocalDocumentation.filter((document) => existsSync(path.join(repoRoot, document))),
      ...currentDocumentationIndexSpecs.map(({ index }) => index),
      ...documentationDirectories.flatMap((directory) => directMarkdownFiles(repoRoot, directory)),
      ...packageDocumentation,
      ...packageReadmes(repoRoot),
      ...additionalDocumentation,
    ]),
  ].sort()
}

function validateIndexCompleteness(repoRoot: string, spec: DocumentationIndexSpec): string[] {
  const indexPath = path.join(repoRoot, spec.index)
  const directoryPath = path.join(repoRoot, spec.directory)
  if (!existsSync(indexPath) || !existsSync(directoryPath)) return []

  const linkedFiles = new Set(
    markdownLocalLinks(readFileSync(indexPath, 'utf8'))
      .map(({ target }) => resolveMarkdownLinkPath(repoRoot, indexPath, target))
      .filter((target): target is string => target !== undefined)
      .map((target) => path.resolve(target)),
  )
  const expectedFiles = directMarkdownFiles(repoRoot, spec.directory)
    .filter((document) => document !== spec.index)
    .map((document) => path.resolve(repoRoot, document))

  return expectedFiles
    .filter((document) => !linkedFiles.has(document))
    .map(
      (document) =>
        `${spec.index} does not index ${JSON.stringify(path.relative(repoRoot, document).replaceAll(path.sep, '/'))}`,
    )
}

function inlineCodeSpans(line: string): string[] {
  const spans: string[] = []
  for (const match of line.matchAll(/(`+)(.+?)\1/g)) spans.push(match[2])
  return spans
}

const rootLiteralPath =
  /(?:^|[\s("'\[])((?:server\/fastify|\.github|src|packages|test|util|public|docs)\/[A-Za-z0-9_@+.-]+(?:\/[A-Za-z0-9_@+.-]+)*\/?)/g

function literalRepositoryPaths(markdown: string): Array<{ lineNumber: number; literalPath: string }> {
  const paths: Array<{ lineNumber: number; literalPath: string }> = []
  for (const { line, lineNumber } of markdownLinesOutsideFences(markdown)) {
    for (const span of inlineCodeSpans(line)) {
      // These forms describe a family or placeholder, not one checkable repository target.
      if (/[*?{}<>]|\.\.\.|…/.test(span)) continue
      for (const match of span.matchAll(rootLiteralPath)) {
        paths.push({ lineNumber, literalPath: match[1] })
      }
    }
  }
  return paths
}

function exemptionKey(document: string | undefined, literalPath: string): string {
  return `${document ?? '*'}\0${literalPath}`
}

function validateLiteralPaths(
  repoRoot: string,
  documentPaths: readonly string[],
  exemptions: readonly LiteralPathExemption[],
): string[] {
  const errors: string[] = []
  const usedExemptions = new Set<string>()
  const exemptionsByKey = new Map(
    exemptions.map((exemption) => [exemptionKey(exemption.document, exemption.path), exemption]),
  )

  for (const document of documentPaths) {
    const markdown = readFileSync(path.join(repoRoot, document), 'utf8')
    for (const { lineNumber, literalPath } of literalRepositoryPaths(markdown)) {
      const targetPath = path.resolve(repoRoot, literalPath)
      if (!isPathWithinRoot(repoRoot, targetPath)) {
        errors.push(`${document}:${lineNumber} references a path outside the repository ${JSON.stringify(literalPath)}`)
        continue
      }
      if (existsSync(targetPath)) continue
      const documentKey = exemptionKey(document, literalPath)
      const globalKey = exemptionKey(undefined, literalPath)
      const exemption = exemptionsByKey.get(documentKey) ?? exemptionsByKey.get(globalKey)
      if (exemption) {
        usedExemptions.add(exemptionKey(exemption.document, exemption.path))
        continue
      }
      errors.push(`${document}:${lineNumber} references missing repository path ${JSON.stringify(literalPath)}`)
    }
  }

  for (const exemption of exemptions) {
    const key = exemptionKey(exemption.document, exemption.path)
    if (!usedExemptions.has(key)) {
      errors.push(
        `unused documentation path exemption for ${JSON.stringify(exemption.path)}${
          exemption.document ? ` in ${exemption.document}` : ''
        }: ${exemption.reason}`,
      )
    }
  }
  return errors
}

export function validateCurrentDocumentation(
  options: CurrentDocumentationValidationOptions = {},
): CurrentDocumentationValidationResult {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd())
  const documentPaths = [...(options.documentPaths ?? currentDocumentationPaths(repoRoot))]
  const indexSpecs = options.indexSpecs ?? currentDocumentationIndexSpecs
  const literalPathExemptions = options.literalPathExemptions ?? currentDocumentationLiteralPathExemptions
  const missingDocuments = documentPaths.filter((document) => !existsSync(path.join(repoRoot, document)))
  const presentDocuments = documentPaths.filter((document) => existsSync(path.join(repoRoot, document)))
  const errors = [
    ...missingDocuments.map((document) => `current documentation file is missing: ${document}`),
    ...validateMarkdownLinks(
      repoRoot,
      presentDocuments.map((document) => path.join(repoRoot, document)),
    ),
    ...indexSpecs.flatMap((spec) => validateIndexCompleteness(repoRoot, spec)),
    ...validateLiteralPaths(repoRoot, presentDocuments, literalPathExemptions),
  ].sort()

  return { documentCount: documentPaths.length, errors, ok: errors.length === 0 }
}

function run(): void {
  const result = validateCurrentDocumentation()
  if (result.ok) {
    console.log(`Current documentation validation passed (${result.documentCount} files).`)
    return
  }
  console.error(`Current documentation validation failed with ${result.errors.length} error(s):`)
  for (const error of result.errors) console.error(`- ${error}`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && existsSync(invokedPath)) run()
