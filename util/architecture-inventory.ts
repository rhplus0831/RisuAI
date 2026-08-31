import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  collectClientResourceObservation,
  compareClientResourceBaseline,
  createClientResourceBaseline,
  type ClientResourceBaseline,
  type ClientResourceOwnerGapMatrix,
  validateClientResourceOwnerGapMatrix,
} from './client-resource-inventory.js'

export type CrossRuntimeLane = 'production' | 'server-test' | 'browser-smoke'
export type ImportKind = 'static' | 're-export' | 'import-equals' | 'dynamic' | 'require' | 'import-type'
export type ImportUsage = 'runtime' | 'type-only' | 'mixed'

export interface CrossRuntimeEdge {
  lane: CrossRuntimeLane
  importer: string
  specifier: string
  target: string
  kind: ImportKind
  usage: ImportUsage
  symbols: string[]
  count: number
}

export interface NonLiteralModuleReference {
  lane: CrossRuntimeLane
  importer: string
  kind: 'dynamic' | 'require'
  count: number
}

export interface ProjectReferenceObservation {
  consumer: string
  target: string
}

export interface MetadataObservation {
  id: string
  owner: string
  path: string
  count: number
}

export interface CrossRuntimeObservation {
  edges: CrossRuntimeEdge[]
  nonLiteralModuleReferences: NonLiteralModuleReference[]
  projectReferences: ProjectReferenceObservation[]
  metadata: MetadataObservation[]
}

export type BoundaryCategory =
  | 'wire-contract'
  | 'pure-runtime-behavior'
  | 'browser-application-model'
  | 'test-fixture'
  | 'server-only-behavior'
  | 'accidental-dependency'

export interface BoundaryPolicy {
  category: BoundaryCategory
  targetOwner: string
  migrationPhase: string
  exceptionOwner: string
  reviewTrigger: string
}

export interface CrossRuntimeBaseline {
  schemaVersion: 1
  openingAnchor: string
  conventions: {
    protocol: string
    sharedRuntime: string
    server: string
    fixtures: string
  }
  policies: Record<string, BoundaryPolicy>
  edges: Array<CrossRuntimeEdge & { policy: string }>
  nonLiteralModuleReferences: Array<
    NonLiteralModuleReference & { owner: string; disposition: string; reviewTrigger: string }
  >
  projectReferences: Array<
    ProjectReferenceObservation & { owner: string; purpose: string; removalPhase: string; reviewTrigger: string }
  >
  metadata: Array<
    MetadataObservation & { authority: string; migrationPhase: string; driftRule: string; reviewTrigger: string }
  >
}

export type CompatibilityDisposition =
  | 'canonical'
  | 'migrate'
  | 'import-only'
  | 'export-only'
  | 'explicit-compatibility'
  | 'temporary'
  | 'quarantine'
  | 'remove'

export interface CompatibilityProbe {
  path: string
  kind: 'identifier' | 'text'
  value: string
  expectedCount: number
}

export interface CompatibilitySurface {
  id: string
  family: 'model-configuration' | 'prompt-template' | 'translator' | 'repair' | 'interchange'
  surface: string
  currentOwner: string
  roles: Array<'read' | 'write' | 'fallback' | 'repair' | 'import' | 'export' | 'backup' | 'recovery'>
  currentPrecedence: string
  missingBehavior: string
  malformedBehavior: string
  damagedDatabaseBehavior: string
  historicalFixture: string
  provenance: string
  disposition: CompatibilityDisposition
  targetOwner: string
  migrationPhase: string
  oldReaderOrExporter: string
  rollbackProof: string
  workstream3Cursor: string
  probes: CompatibilityProbe[]
}

export interface CompatibilityBaseline {
  schemaVersion: 1
  openingAnchor: string
  conventionRelease: string
  decisionPolicy: string
  surfaces: CompatibilitySurface[]
}

const POLICY_IDS = {
  wire: 'protocol-wire-contract',
  pure: 'shared-pure-runtime',
  application: 'browser-application-model',
  fixture: 'test-fixture',
  server: 'server-only-extraction',
  accidental: 'accidental-browser-support',
} as const

export const DEFAULT_BOUNDARY_POLICIES: Record<string, BoundaryPolicy> = {
  [POLICY_IDS.wire]: {
    category: 'wire-contract',
    targetOwner: '@risuai/protocol explicit subpath',
    migrationPhase: 'Workstream 1 Phase 1, then consuming Phase 4/5 slice',
    exceptionOwner: 'Cross-runtime boundaries maintainers',
    reviewTrigger: 'Protocol parity is proven and all consumers use the explicit package subpath.',
  },
  [POLICY_IDS.pure]: {
    category: 'pure-runtime-behavior',
    targetOwner: 'audited framework-neutral shared runtime package',
    migrationPhase: 'Workstream 1 Phase 3, then consuming Phase 4/5 slice',
    exceptionOwner: 'Cross-runtime boundaries maintainers',
    reviewTrigger: 'A neutral leaf extraction passes browser/server parity and the shared import audit.',
  },
  [POLICY_IDS.application]: {
    category: 'browser-application-model',
    targetOwner: 'narrow protocol/shared domain input plus runtime-owned adapter',
    migrationPhase: 'Workstream 1 Phase 4',
    exceptionOwner: 'Fastify domain owner',
    reviewTrigger: 'The server consumer no longer needs a browser aggregate or application model declaration.',
  },
  [POLICY_IDS.fixture]: {
    category: 'test-fixture',
    targetOwner: 'runtime-neutral test fixture adjacent to its owning lane',
    migrationPhase: 'Workstream 1 Phase 4',
    exceptionOwner: 'Owning test lane maintainer',
    reviewTrigger: 'The fixture is moved or the retained test-only exception receives an explicit closeout decision.',
  },
  [POLICY_IDS.server]: {
    category: 'server-only-behavior',
    targetOwner: 'server/fastify narrow server-owned implementation',
    migrationPhase: 'Workstream 1 Phase 4',
    exceptionOwner: 'Fastify domain owner',
    reviewTrigger: 'The server-owned behavior no longer imports its browser implementation.',
  },
  [POLICY_IDS.accidental]: {
    category: 'accidental-dependency',
    targetOwner: 'owning browser-smoke/server-test support boundary',
    migrationPhase: 'Workstream 1 Phase 4 or 5',
    exceptionOwner: 'Owning smoke or server-test maintainer',
    reviewTrigger: 'Equivalent neutral support exists or the exception is explicitly retained at closeout.',
  },
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts']
const RUNTIME_PROTOCOL_TARGETS = [
  '/process/displaySourceProtocol.ts',
  '/process/request/clientContext.ts',
  '/process/request/serverToolProtocol.ts',
  '/server/characterSummaryProtocol.ts',
  '/server/embeddingOperationsProtocol.ts',
  '/server/imageGenerationProtocol.ts',
  '/server/mcpOAuthRefreshProtocol.ts',
  '/server/providerOperationsProtocol.ts',
  '/server/shellProtocol.ts',
  '/server/standaloneSettingsProtocol.ts',
  '/server/ttsProtocol.ts',
]
const APPLICATION_MODEL_TARGETS = [
  '/storage/database.svelte.ts',
  '/process/index.svelte.ts',
  '/parser/parser.svelte.ts',
  '/process/modules.ts',
  '/process/prompt.ts',
  '/process/triggers.ts',
]

function repoPath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).replaceAll(path.sep, '/')
}

function walkSourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkSourceFiles(absolutePath))
    else if (entry.isFile() && SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      files.push(absolutePath)
    }
  }
  return files.sort()
}

function sourceKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  return ts.ScriptKind.TS
}

function literalText(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null
}

function importedSymbols(node: ts.ImportDeclaration): { symbols: string[]; usage: ImportUsage } {
  const clause = node.importClause
  if (!clause) return { symbols: ['<side-effect>'], usage: 'runtime' }
  const symbols: Array<{ name: string; typeOnly: boolean }> = []
  if (clause.name) symbols.push({ name: 'default', typeOnly: clause.isTypeOnly })
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    symbols.push({ name: '*', typeOnly: clause.isTypeOnly })
  } else if (clause.namedBindings) {
    for (const element of clause.namedBindings.elements) {
      symbols.push({
        name: element.propertyName?.text ?? element.name.text,
        typeOnly: clause.isTypeOnly || element.isTypeOnly,
      })
    }
  }
  const typeCount = symbols.filter((symbol) => symbol.typeOnly).length
  const usage: ImportUsage = typeCount === 0 ? 'runtime' : typeCount === symbols.length ? 'type-only' : 'mixed'
  return { symbols: symbols.map((symbol) => symbol.name).sort(), usage }
}

function exportedSymbols(node: ts.ExportDeclaration): { symbols: string[]; usage: ImportUsage } {
  if (!node.exportClause) return { symbols: ['*'], usage: node.isTypeOnly ? 'type-only' : 'runtime' }
  if (ts.isNamespaceExport(node.exportClause)) {
    return { symbols: ['*'], usage: node.isTypeOnly ? 'type-only' : 'runtime' }
  }
  const symbols = node.exportClause.elements.map((element) => ({
    name: element.propertyName?.text ?? element.name.text,
    typeOnly: node.isTypeOnly || element.isTypeOnly,
  }))
  const typeCount = symbols.filter((symbol) => symbol.typeOnly).length
  const usage: ImportUsage = typeCount === 0 ? 'runtime' : typeCount === symbols.length ? 'type-only' : 'mixed'
  return { symbols: symbols.map((symbol) => symbol.name).sort(), usage }
}

function canonicalTarget(repoRoot: string, importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const rawTarget = path.resolve(path.dirname(importer), specifier)
  const candidates = [
    rawTarget,
    `${rawTarget}.ts`,
    `${rawTarget}.tsx`,
    path.join(rawTarget, 'index.ts'),
    rawTarget.replace(/\.js$/, '.ts'),
    rawTarget.replace(/\.mjs$/, '.mts'),
    rawTarget.replace(/\.cjs$/, '.cts'),
  ]
  const existing = candidates.find((candidate) => fs.existsSync(candidate))
  if (!existing) return null
  const sourceRoot = path.join(repoRoot, 'src')
  const relative = path.relative(sourceRoot, existing)
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return repoPath(repoRoot, existing)
}

interface RawEdge extends Omit<CrossRuntimeEdge, 'count'> {}

function collectFileEdges(
  repoRoot: string,
  lane: CrossRuntimeLane,
  file: string,
): {
  edges: RawEdge[]
  nonLiteral: Array<Omit<NonLiteralModuleReference, 'count'>>
} {
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, sourceKind(file))
  const importer = repoPath(repoRoot, file)
  const edges: RawEdge[] = []
  const nonLiteral: Array<Omit<NonLiteralModuleReference, 'count'>> = []

  const record = (specifier: string, kind: ImportKind, usage: ImportUsage, symbols: string[]): void => {
    const target = canonicalTarget(repoRoot, file, specifier)
    if (!target) return
    edges.push({ lane, importer, specifier, target, kind, usage, symbols: [...new Set(symbols)].sort() })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const { symbols, usage } = importedSymbols(node)
      record(node.moduleSpecifier.text, 'static', usage, symbols)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const { symbols, usage } = exportedSymbols(node)
      record(node.moduleSpecifier.text, 're-export', usage, symbols)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = literalText(node.moduleReference.expression)
      if (specifier) record(specifier, 'import-equals', node.isTypeOnly ? 'type-only' : 'runtime', ['*'])
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
        record(argument.literal.text, 'import-type', 'type-only', ['*'])
      }
    } else if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamicImport || requireCall) {
        const specifier = literalText(node.arguments[0])
        const kind = dynamicImport ? 'dynamic' : 'require'
        if (specifier) record(specifier, kind, 'runtime', ['*'])
        else nonLiteral.push({ lane, importer, kind })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { edges, nonLiteral }
}

export function collectSourceFileModuleEdges(
  repoRoot: string,
  lane: CrossRuntimeLane,
  file: string,
): {
  edges: CrossRuntimeEdge[]
  nonLiteralModuleReferences: NonLiteralModuleReference[]
} {
  const observed = collectFileEdges(repoRoot, lane, file)
  return {
    edges: aggregate(
      observed.edges,
      (edge) =>
        `${edge.lane}\0${edge.importer}\0${edge.specifier}\0${edge.target}\0${edge.kind}\0${edge.usage}\0${edge.symbols.join(',')}`,
    ),
    nonLiteralModuleReferences: aggregate(
      observed.nonLiteral,
      (reference) => `${reference.lane}\0${reference.importer}\0${reference.kind}`,
    ),
  }
}

function aggregate<T extends object>(rows: T[], key: (row: T) => string): Array<T & { count: number }> {
  const grouped = new Map<string, T & { count: number }>()
  for (const row of rows) {
    const id = key(row)
    const current = grouped.get(id)
    if (current) current.count += 1
    else grouped.set(id, { ...row, count: 1 })
  }
  return [...grouped.values()].sort((left, right) => key(left).localeCompare(key(right)))
}

function collectProjectReferences(repoRoot: string): ProjectReferenceObservation[] {
  const configs = ['server/fastify/tsconfig.json', 'tsconfig.browser-smoke.json']
  return configs
    .flatMap((config) => {
      const configPath = path.join(repoRoot, config)
      const read = ts.readConfigFile(configPath, ts.sys.readFile)
      if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
      const references = (read.config.references ?? []) as Array<{ path?: string }>
      return references.flatMap((reference) => {
        if (!reference.path) return []
        let target = path.resolve(path.dirname(configPath), reference.path)
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'tsconfig.json')
        else if (!path.extname(target)) target = `${target}.json`
        return [{ consumer: config, target: repoPath(repoRoot, target) }]
      })
    })
    .sort((left, right) => `${left.consumer}\0${left.target}`.localeCompare(`${right.consumer}\0${right.target}`))
}

function namedInitializer(repoRoot: string, file: string, name: string): ts.Expression {
  const absolutePath = path.join(repoRoot, file)
  const sourceFile = ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    sourceKind(file),
  )
  let initializer: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      initializer = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!initializer) throw new Error(`Could not find ${name} in ${file}`)
  while (
    ts.isAsExpression(initializer) ||
    ts.isSatisfiesExpression(initializer) ||
    ts.isParenthesizedExpression(initializer)
  ) {
    initializer = initializer.expression
  }
  return initializer
}

function collectionSize(initializer: ts.Expression): number {
  if (ts.isArrayLiteralExpression(initializer)) return initializer.elements.length
  if (ts.isObjectLiteralExpression(initializer)) return initializer.properties.length
  throw new Error('Expected an array or object literal architecture catalog')
}

function countLiteralRouteRegistrations(repoRoot: string): number {
  let count = 0
  const routeRoot = path.join(repoRoot, 'server/fastify/src/routes')
  for (const file of walkSourceFiles(routeRoot)) {
    const sourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      sourceKind(file),
    )
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'app' &&
        ['get', 'post', 'patch', 'put', 'delete', 'options', 'head'].includes(node.expression.name.text) &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        count += 1
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return count
}

function collectMetadata(repoRoot: string): MetadataObservation[] {
  return [
    {
      id: 'server-route-policy',
      owner: 'Fastify authentication and active-writer authority',
      path: 'server/fastify/src/routeManifest.ts#PROTOCOL_ROUTE_POLICIES',
      count: collectionSize(
        namedInitializer(repoRoot, 'server/fastify/src/routeManifest.ts', 'PROTOCOL_ROUTE_POLICIES'),
      ),
    },
    {
      id: 'shared-route-operation-catalog',
      owner: 'Browser-safe non-authoritative route transport metadata',
      path: 'packages/protocol/src/routeOperation.ts#PROTOCOL_ROUTE_OPERATION_CATALOG',
      count: collectionSize(
        namedInitializer(repoRoot, 'packages/protocol/src/routeOperation.ts', 'PROTOCOL_ROUTE_OPERATION_CATALOG'),
      ),
    },
    {
      id: 'literal-route-registrations',
      owner: 'Fastify route modules (observation only; prefixes and generated registrations need separate parity)',
      path: 'server/fastify/src/routes/**/*.ts#app.<method>(literal)',
      count: countLiteralRouteRegistrations(repoRoot),
    },
    {
      id: 'shared-durable-command-operation-catalog',
      owner: 'Browser-safe retained-intent operation catalog; never a security authority',
      path: 'packages/protocol/src/durableCommandOperation.ts#PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG',
      count: collectionSize(
        namedInitializer(
          repoRoot,
          'packages/protocol/src/durableCommandOperation.ts',
          'PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG',
        ),
      ),
    },
    {
      id: 'browser-resource-surfaces',
      owner: 'Shared browser hydration and cache resource metadata',
      path: 'packages/shared-core/src/resourceManifest.ts#RESOURCE_SURFACE_MANIFEST',
      count: collectionSize(
        namedInitializer(repoRoot, 'packages/shared-core/src/resourceManifest.ts', 'RESOURCE_SURFACE_MANIFEST'),
      ),
    },
    {
      id: 'browser-operation-bindings',
      owner: 'Browser-safe route operation relations; never a security authority',
      path: 'src/ts/server/browserOperationManifest.ts#BROWSER_OPERATION_BINDINGS',
      count: collectionSize(
        namedInitializer(repoRoot, 'src/ts/server/browserOperationManifest.ts', 'BROWSER_OPERATION_BINDINGS'),
      ),
    },
    {
      id: 'browser-operation-non-overlaps',
      owner: 'Reviewed browser-only operation vocabulary distinctions',
      path: 'src/ts/server/browserOperationManifest.ts#BROWSER_OPERATION_NON_OVERLAPS',
      count: collectionSize(
        namedInitializer(repoRoot, 'src/ts/server/browserOperationManifest.ts', 'BROWSER_OPERATION_NON_OVERLAPS'),
      ),
    },
    {
      id: 'server-command-event-catalog',
      owner: 'Fastify persisted command event vocabulary',
      path: 'server/fastify/src/commands/events.ts#COMMAND_EVENT_CATALOG',
      count: collectionSize(
        namedInitializer(repoRoot, 'server/fastify/src/commands/events.ts', 'COMMAND_EVENT_CATALOG'),
      ),
    },
  ].sort((left, right) => left.id.localeCompare(right.id))
}

export function collectCrossRuntimeObservation(repoRoot: string): CrossRuntimeObservation {
  const lanes: Array<{ lane: CrossRuntimeLane; roots: string[] }> = [
    { lane: 'production', roots: ['server/fastify/src'] },
    { lane: 'server-test', roots: ['server/fastify/__tests__', 'server/fastify/__fixtures__'] },
    { lane: 'browser-smoke', roots: ['server/fastify/browser-smoke'] },
  ]
  const rawEdges: RawEdge[] = []
  const rawNonLiteral: Array<Omit<NonLiteralModuleReference, 'count'>> = []
  for (const { lane, roots } of lanes) {
    for (const root of roots) {
      for (const file of walkSourceFiles(path.join(repoRoot, root))) {
        const observed = collectFileEdges(repoRoot, lane, file)
        rawEdges.push(...observed.edges)
        rawNonLiteral.push(...observed.nonLiteral)
      }
    }
  }
  const edges = aggregate(
    rawEdges,
    (edge) =>
      `${edge.lane}\0${edge.importer}\0${edge.specifier}\0${edge.target}\0${edge.kind}\0${edge.usage}\0${edge.symbols.join(',')}`,
  )
  const nonLiteralModuleReferences = aggregate(
    rawNonLiteral,
    (reference) => `${reference.lane}\0${reference.importer}\0${reference.kind}`,
  )
  return {
    edges,
    nonLiteralModuleReferences,
    projectReferences: collectProjectReferences(repoRoot),
    metadata: collectMetadata(repoRoot),
  }
}

function suggestedPolicy(target: string): string {
  if (target.includes('/__tests__/') || target.includes('/tests/') || target.includes('/__fixtures__/')) {
    return POLICY_IDS.fixture
  }
  if (RUNTIME_PROTOCOL_TARGETS.some((suffix) => target.endsWith(suffix))) return POLICY_IDS.wire
  if (APPLICATION_MODEL_TARGETS.some((suffix) => target.endsWith(suffix))) return POLICY_IDS.application
  if (target === 'src/lang/en.ts' || target.endsWith('/startupReadiness.ts') || target.endsWith('/routerRoute.ts')) {
    return POLICY_IDS.accidental
  }
  if (target.endsWith('/server/browserSmoke.ts')) return POLICY_IDS.accidental
  return POLICY_IDS.pure
}

export function createCrossRuntimeBaseline(
  observation: CrossRuntimeObservation,
  openingAnchor: string,
): CrossRuntimeBaseline {
  return {
    schemaVersion: 1,
    openingAnchor,
    conventions: {
      protocol:
        'Serialized requests, responses, events, versions, and taxonomies live in browser-safe @risuai/protocol subpaths.',
      sharedRuntime:
        'Only framework-neutral leaf behavior may enter an audited shared runtime package; it cannot depend on Svelte, DOM, Fastify, Node hosts, persistence, or aggregate Database state.',
      server:
        'Security, active-writer policy, persistence, credentials, filesystem, process, and host behavior remain under server/fastify.',
      fixtures:
        'Historical compatibility fixtures remain test-owned; shared fixture data may move without moving browser application modules into a server dependency.',
    },
    policies: DEFAULT_BOUNDARY_POLICIES,
    edges: observation.edges.map((edge) => ({ ...edge, policy: suggestedPolicy(edge.target) })),
    nonLiteralModuleReferences: observation.nonLiteralModuleReferences.map((reference) => ({
      ...reference,
      owner: 'Owning runtime lane',
      disposition: 'Grandfathered dynamic module selection; not currently resolved to the browser src tree.',
      reviewTrigger: 'The expression changes, becomes a browser-tree edge, or its owning Phase 4 slice migrates.',
    })),
    projectReferences: observation.projectReferences.map((reference) => ({
      ...reference,
      owner: 'check:server declaration prerequisite',
      purpose: 'Makes current browser-tree types available to Fastify/browser-smoke strict typechecks.',
      removalPhase: 'Workstream 1 Phase 6 after every requiring edge is migrated.',
      reviewTrigger:
        'The cross-runtime edge inventory reaches zero for consumers requiring emitted client declarations.',
    })),
    metadata: observation.metadata.map((entry) => ({
      ...entry,
      authority: entry.owner,
      migrationPhase: 'Workstream 1 Phase 2 exact operation/policy catalog',
      driftRule: 'Count and owner changes require a reviewed baseline update; policy parity is established in Phase 2.',
      reviewTrigger:
        'A route, durable operation, resource surface, cache/stream class, or command event is added or removed.',
    })),
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function observationProjection(baseline: CrossRuntimeBaseline): CrossRuntimeObservation {
  return {
    edges: baseline.edges.map(({ policy: _policy, ...edge }) => edge),
    nonLiteralModuleReferences: baseline.nonLiteralModuleReferences.map(
      ({ owner: _owner, disposition: _disposition, reviewTrigger: _reviewTrigger, ...reference }) => reference,
    ),
    projectReferences: baseline.projectReferences.map(
      ({
        owner: _owner,
        purpose: _purpose,
        removalPhase: _removalPhase,
        reviewTrigger: _reviewTrigger,
        ...reference
      }) => reference,
    ),
    metadata: baseline.metadata.map(
      ({
        authority: _authority,
        migrationPhase: _migrationPhase,
        driftRule: _driftRule,
        reviewTrigger: _reviewTrigger,
        ...entry
      }) => entry,
    ),
  }
}

export function validateCrossRuntimeBaseline(baseline: CrossRuntimeBaseline): string[] {
  const errors: string[] = []
  if (baseline.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  for (const [id, policy] of Object.entries(baseline.policies)) {
    if (!id.trim()) errors.push('policy ids must be non-empty')
    for (const [field, value] of Object.entries(policy)) {
      if (typeof value !== 'string' || !value.trim()) errors.push(`policy ${id} has an empty ${field}`)
    }
  }
  for (const edge of baseline.edges) {
    if (!baseline.policies[edge.policy])
      errors.push(`edge ${edge.importer} -> ${edge.target} uses unknown policy ${edge.policy}`)
  }
  for (const reference of baseline.projectReferences) {
    if (!reference.owner || !reference.purpose || !reference.removalPhase || !reference.reviewTrigger) {
      errors.push(`project reference ${reference.consumer} -> ${reference.target} has incomplete ownership metadata`)
    }
  }
  for (const entry of baseline.metadata) {
    if (!entry.authority || !entry.migrationPhase || !entry.driftRule || !entry.reviewTrigger) {
      errors.push(`metadata inventory ${entry.id} has incomplete ownership metadata`)
    }
  }
  return errors
}

export function compareCrossRuntimeBaseline(
  observation: CrossRuntimeObservation,
  baseline: CrossRuntimeBaseline,
): string[] {
  const errors = validateCrossRuntimeBaseline(baseline)
  const expected = stableJson(observationProjection(baseline))
  const actual = stableJson(observation)
  if (expected !== actual) {
    const expectedDigest = createHash('sha256').update(expected).digest('hex')
    const actualDigest = createHash('sha256').update(actual).digest('hex')
    errors.push(
      `cross-runtime architecture inventory drifted (expected sha256 ${expectedDigest}, observed ${actualDigest}); run util/architecture-inventory.ts --print-cross-runtime and review every manifest change`,
    )
  }
  return errors
}

function countTextOccurrences(source: string, value: string): number {
  if (!value) return 0
  let count = 0
  let offset = 0
  while ((offset = source.indexOf(value, offset)) >= 0) {
    count += 1
    offset += value.length
  }
  return count
}

function countIdentifierOccurrences(file: string, source: string, value: string): number {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, sourceKind(file))
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === value) count += 1
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return count
}

export function observeCompatibilityProbe(repoRoot: string, probe: CompatibilityProbe): number {
  const absolutePath = path.join(repoRoot, probe.path)
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Compatibility probe path does not exist: ${probe.path}`)
  }
  const source = fs.readFileSync(absolutePath, 'utf8')
  return probe.kind === 'identifier'
    ? countIdentifierOccurrences(absolutePath, source, probe.value)
    : countTextOccurrences(source, probe.value)
}

export function refreshCompatibilityBaseline(repoRoot: string, baseline: CompatibilityBaseline): CompatibilityBaseline {
  return {
    ...baseline,
    surfaces: baseline.surfaces.map((surface) => ({
      ...surface,
      probes: surface.probes.map((probe) => ({
        ...probe,
        expectedCount: observeCompatibilityProbe(repoRoot, probe),
      })),
    })),
  }
}

export function validateCompatibilityBaseline(repoRoot: string, baseline: CompatibilityBaseline): string[] {
  const errors: string[] = []
  if (baseline.schemaVersion !== 1) errors.push('compatibility schemaVersion must be 1')
  if (!baseline.openingAnchor || !baseline.conventionRelease || !baseline.decisionPolicy) {
    errors.push('compatibility baseline is missing its anchor, convention release, or decision policy')
  }
  const ids = new Set<string>()
  for (const surface of baseline.surfaces) {
    if (ids.has(surface.id)) errors.push(`duplicate compatibility surface id: ${surface.id}`)
    ids.add(surface.id)
    const requiredText: Array<[string, string]> = [
      ['surface', surface.surface],
      ['currentOwner', surface.currentOwner],
      ['currentPrecedence', surface.currentPrecedence],
      ['missingBehavior', surface.missingBehavior],
      ['malformedBehavior', surface.malformedBehavior],
      ['damagedDatabaseBehavior', surface.damagedDatabaseBehavior],
      ['historicalFixture', surface.historicalFixture],
      ['provenance', surface.provenance],
      ['targetOwner', surface.targetOwner],
      ['migrationPhase', surface.migrationPhase],
      ['oldReaderOrExporter', surface.oldReaderOrExporter],
      ['rollbackProof', surface.rollbackProof],
      ['workstream3Cursor', surface.workstream3Cursor],
    ]
    for (const [field, value] of requiredText) {
      if (!value.trim()) errors.push(`compatibility surface ${surface.id} has empty ${field}`)
    }
    if (surface.roles.length === 0) errors.push(`compatibility surface ${surface.id} has no roles`)
    if (surface.probes.length === 0) errors.push(`compatibility surface ${surface.id} has no closed-world probes`)
    const fixturePath = surface.historicalFixture.split('#', 1)[0]
    if (!fs.existsSync(path.join(repoRoot, fixturePath))) {
      errors.push(`compatibility surface ${surface.id} fixture does not exist: ${fixturePath}`)
    }
    for (const probe of surface.probes) {
      try {
        const actual = observeCompatibilityProbe(repoRoot, probe)
        if (actual !== probe.expectedCount) {
          errors.push(
            `compatibility surface ${surface.id} probe drifted: ${probe.path} ${probe.kind} ${JSON.stringify(probe.value)} expected ${probe.expectedCount}, observed ${actual}`,
          )
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  return errors
}

function loadBaseline(file: string): CrossRuntimeBaseline {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CrossRuntimeBaseline
}

function loadCompatibilityBaseline(file: string): CompatibilityBaseline {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CompatibilityBaseline
}

function loadClientResourceBaseline(file: string): ClientResourceBaseline {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ClientResourceBaseline
}

function loadClientResourceOwnerGapMatrix(file: string): ClientResourceOwnerGapMatrix {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ClientResourceOwnerGapMatrix
}

async function run(): Promise<void> {
  const repoRoot = process.cwd()
  const baselinePath = path.join(
    repoRoot,
    '.archived-docs/architecture-and-migration/cross-runtime-boundaries/baseline.json',
  )
  const compatibilityBaselinePath = path.join(
    repoRoot,
    'docs/plan/canonical-state-and-compatibility/compatibility-baseline.json',
  )
  const clientResourceBaselinePath = path.join(
    repoRoot,
    'docs/plan/client-resource-ownership/client-resource-baseline.json',
  )
  const clientResourceOwnerGapMatrixPath = path.join(
    repoRoot,
    'docs/plan/client-resource-ownership/owner-api-gap-matrix.json',
  )
  const observation = collectCrossRuntimeObservation(repoRoot)
  if (process.argv.includes('--print-cross-runtime')) {
    process.stdout.write(
      stableJson(createCrossRuntimeBaseline(observation, 'c0df82d5240a29a33efa5995e08cc970e0147573')),
    )
    return
  }
  if (process.argv.includes('--print-compatibility')) {
    if (!fs.existsSync(compatibilityBaselinePath)) {
      throw new Error(`Missing compatibility baseline: ${compatibilityBaselinePath}`)
    }
    process.stdout.write(
      stableJson(refreshCompatibilityBaseline(repoRoot, loadCompatibilityBaseline(compatibilityBaselinePath))),
    )
    return
  }
  const clientResourceObservation = collectClientResourceObservation(repoRoot)
  if (process.argv.includes('--print-client-resources')) {
    process.stdout.write(
      stableJson(
        createClientResourceBaseline(
          clientResourceObservation,
          'c0df82d5240a29a33efa5995e08cc970e0147573',
          'b01e88b03461753afe8f573029ce2e5ab47892ef',
        ),
      ),
    )
    return
  }
  if (!fs.existsSync(baselinePath)) throw new Error(`Missing cross-runtime architecture baseline: ${baselinePath}`)
  if (!fs.existsSync(compatibilityBaselinePath)) {
    throw new Error(`Missing compatibility baseline: ${compatibilityBaselinePath}`)
  }
  if (!fs.existsSync(clientResourceBaselinePath)) {
    throw new Error(`Missing client resource baseline: ${clientResourceBaselinePath}`)
  }
  if (!fs.existsSync(clientResourceOwnerGapMatrixPath)) {
    throw new Error(`Missing client resource owner gap matrix: ${clientResourceOwnerGapMatrixPath}`)
  }
  const compatibilityBaseline = loadCompatibilityBaseline(compatibilityBaselinePath)
  const clientResourceBaseline = loadClientResourceBaseline(clientResourceBaselinePath)
  const errors = [
    ...compareCrossRuntimeBaseline(observation, loadBaseline(baselinePath)),
    ...validateCompatibilityBaseline(repoRoot, compatibilityBaseline),
    ...compareClientResourceBaseline(clientResourceObservation, clientResourceBaseline),
    ...validateClientResourceOwnerGapMatrix(
      repoRoot,
      clientResourceBaseline,
      loadClientResourceOwnerGapMatrix(clientResourceOwnerGapMatrixPath),
    ),
  ]
  if (errors.length > 0) {
    for (const error of errors) console.error(`[architecture-inventory] ${error}`)
    process.exitCode = 1
    return
  }
  const runtimeEdges = observation.edges.reduce(
    (total, edge) => total + (edge.usage === 'type-only' ? 0 : edge.count),
    0,
  )
  const edgeCount = observation.edges.reduce((total, edge) => total + edge.count, 0)
  const laneCounts = Object.fromEntries(
    (['production', 'server-test', 'browser-smoke'] as const).map((lane) => [
      lane,
      observation.edges.filter((edge) => edge.lane === lane).reduce((total, edge) => total + edge.count, 0),
    ]),
  )
  console.log(
    `[architecture-inventory] PASS ${edgeCount} cross-runtime edges (${runtimeEdges} runtime/mixed) across production=${laneCounts.production}, server-test=${laneCounts['server-test']}, browser-smoke=${laneCounts['browser-smoke']}`,
  )
  const probeCount = compatibilityBaseline.surfaces.reduce((total, surface) => total + surface.probes.length, 0)
  console.log(
    `[architecture-inventory] PASS ${compatibilityBaseline.surfaces.length} compatibility surfaces with ${probeCount} closed-world probes`,
  )
  const clientConsumerCount = clientResourceBaseline.consumers.reduce(
    (total, consumer) => total + consumer.files.reduce((fileTotal, file) => fileTotal + file.count, 0),
    0,
  )
  console.log(
    `[architecture-inventory] PASS ${clientConsumerCount} test-fixture compatibility references across ${clientResourceBaseline.consumers.length} consumer groups, ${clientResourceBaseline.bridgeFamilies.length} bridge families, and ${clientResourceBaseline.temporarySeams.length} reviewed seam markers`,
  )
  console.log(
    `[architecture-inventory] PASS ${Object.keys(clientResourceBaseline.policies).length} client resource owner gap rows`,
  )
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  run().catch((error) => {
    console.error(`[architecture-inventory] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
