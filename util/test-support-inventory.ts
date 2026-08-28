import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const TEST_SUPPORT_INVENTORY_SCHEMA_VERSION = 1 as const

export type SupportArtifactRole =
  | 'runner-config-ci'
  | 'performance-budget-tooling'
  | 'compatibility-harness'
  | 'prompt-fixture-corpus'
  | 'shared-helper-harness'
  | 'snapshot-screenshot'

export interface SupportArtifactGroup {
  role: SupportArtifactRole
  files: string[]
}

export interface TestSupportInventoryDocument {
  schemaVersion: typeof TEST_SUPPORT_INVENTORY_SCHEMA_VERSION
  standaloneCount: number
  mixedProductionCount: number
  groups: SupportArtifactGroup[]
  mixedProductionTestSeams: string[]
  intentionalExclusions: string[]
}

const runnerConfigFiles = [
  '.archived-docs/performance-and-stability/frontend-test-architecture/phase-0-inventory.tsv',
  '.github/workflows/quality.yml',
  'docs/plan/test-suite-effectiveness-audit/inventory.json',
  'docs/plan/test-suite-effectiveness-audit/case-counts.json',
  'docs/plan/test-suite-effectiveness-audit/support-artifacts.json',
  'package.json',
  'playwright.fastify-smoke.config.ts',
  'server/fastify/tsconfig.json',
  'server/fastify/vitest.config.ts',
  'tsconfig.browser-smoke.json',
  'tsconfig.client-lib.json',
  'util/affected-tests.ts',
  'util/check-server.ts',
  'util/frontend-test-inventory.ts',
  'util/test-all.ts',
  'util/test-case-counts.ts',
  'util/test-effectiveness-inventory.ts',
  'util/test-support-inventory.ts',
  'vite.config.ts',
  'vitest.config.ts',
  'vitest.dom.config.ts',
  'vitest.dom.setup.ts',
  'vitest.fetchGuard.ts',
  'vitest.frontend-routing.ts',
  'vitest.node.config.ts',
  'vitest.performance-tests.ts',
  'vitest.setup.ts',
  'vitest.svelte-node.config.ts',
  'vitest.svelte-node.environment.ts',
  'vitest.ui-coverage-tests.ts',
] as const

const performanceBudgetFiles = [
  'util/bundle-boundary-report.ts',
  'util/fast-bootstrap-boundaries.ts',
  'util/initial-preload-budgets.json',
  'util/initial-preload-report.ts',
] as const

const fixedSharedHelperFiles = [
  'server/fastify/__fixtures__/risuSave/fixtures.ts',
  'server/fastify/src/risuSave/fixtureHarness.ts',
  'server/fastify/browser-smoke/auth.ts',
  'server/fastify/browser-smoke/fastBootstrapHarness.ts',
  'server/fastify/browser-smoke/globals.d.ts',
  'src/lib/ChatScreens/Chat.parserDependenciesHarness.svelte',
  'src/lib/ChatScreens/DefaultChatScreen.shellGreetingStub.svelte',
  'src/lib/_audit/domStateOracle.ts',
  'src/ts/parser/tests/cbs/lib.ts',
] as const

export const mixedProductionTestSeams = [
  'server/fastify/src/generation/bedrock.ts',
  'server/fastify/src/generation/openrouterFreeModel.ts',
  'server/fastify/src/generation/vertexAuth.ts',
  'server/fastify/src/prompt/luaRuntime.ts',
  'server/fastify/src/prompt/prefixTokenMemo.ts',
  'src/appStartup.ts',
  'src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts',
  'src/lib/ChatScreens/chatRowsBuildInstrumentation.ts',
  'src/ts/agentPresets.ts',
  'src/ts/kei/backup.ts',
  'src/ts/model/llmgateway.ts',
  'src/ts/model/modellist.ts',
  'src/ts/model/nanogpt.ts',
  'src/ts/model/neuralwatt.ts',
  'src/ts/model/ollama.ts',
  'src/ts/model/openrouter.ts',
  'src/ts/observer.svelte.ts',
  'src/ts/observerRouteIntent.ts',
  'src/ts/observerShellFlag.ts',
  'src/ts/observerShellLifecycle.svelte.ts',
  'src/ts/parser/parser.svelte.ts',
  'src/ts/plugins/apiV3/v3.svelte.ts',
  'src/ts/plugins/plugins.svelte.ts',
  'src/ts/process/acceptedSendCoordinator.svelte.ts',
  'src/ts/process/acceptedSendRecoveryState.ts',
  'src/ts/process/chatSuggestionCompletion.svelte.ts',
  'src/ts/process/chatUnread.svelte.ts',
  'src/ts/process/generatedMessageTranslationEligibility.ts',
  'src/ts/process/generationActivity.svelte.ts',
  'src/ts/process/generationDisplayProjection.svelte.ts',
  'src/ts/process/generationEffectLedger.ts',
  'src/ts/process/generationPersistenceState.ts',
  'src/ts/process/generationRuntimeBridge.ts',
  'src/ts/process/halfStreamingProgress.ts',
  'src/ts/process/inputHookActivity.svelte.ts',
  'src/ts/process/mcp/filesystemclient.ts',
  'src/ts/process/reattach.ts',
  'src/ts/process/regexDisplayActivation.ts',
  'src/ts/process/regexDisplayReload.ts',
  'src/ts/process/scriptings.ts',
  'src/ts/process/scripts.ts',
  'src/ts/process/stableDiff.ts',
  'src/ts/server/activeWriterSession.ts',
  'src/ts/server/browserSmoke.ts',
  'src/ts/server/characterShellHydration.svelte.ts',
  'src/ts/server/chatRetainedProjection.ts',
  'src/ts/server/commands.ts',
  'src/ts/server/displaySources.ts',
  'src/ts/server/draftRecoveryScope.ts',
  'src/ts/server/generationOperations.ts',
  'src/ts/server/lorebookBridge.svelte.ts',
  'src/ts/server/memoryJobProjection.svelte.ts',
  'src/ts/server/moduleEditorDraftStore.ts',
  'src/ts/server/pendingMutationOutbox.ts',
  'src/ts/server/persistenceActivity.svelte.ts',
  'src/ts/server/promptTemplateBridge.svelte.ts',
  'src/ts/server/scopedLorebookMutationUiState.ts',
  'src/ts/server/scriptDefinitionBridge.svelte.ts',
  'src/ts/server/startupTelemetry.ts',
  'src/ts/startupReadiness.ts',
  'src/ts/storage/database.svelte.ts',
  'src/ts/storage/fastifyStorage.ts',
  'src/ts/translator/translator.ts',
  'src/vite-env.d.ts',
] as const

const intentionalExclusions = [
  'ordinary *.test.ts and *.spec.ts owners, including special performance, stress, and browser owners',
  'inline fixtures and mocks declared inside ordinary test files',
  'documentation and READMEs, except the live checked frontend routing TSV',
  'generated and runtime state under dist, coverage, test-results, fast-bootstrap-results, data*, and node_modules',
  'vendored/static payloads, lockfiles, and production subjects merely imported by tests',
  'runtime exportSnapshot.ts, importSnapshot.ts, and modelPresetSnapshots.ts production owners',
  'the external compatibility worktree and untracked compatibility scratch output',
] as const

function trackedFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'git ls-files failed')
  return result.stdout.split('\0').filter(Boolean).sort()
}

function uniqueSorted(files: Iterable<string>): string[] {
  return [...new Set(files)].sort()
}

function filesForRole(files: readonly string[], role: SupportArtifactRole): string[] {
  switch (role) {
    case 'runner-config-ci':
      return uniqueSorted(runnerConfigFiles)
    case 'performance-budget-tooling':
      return uniqueSorted(performanceBudgetFiles)
    case 'compatibility-harness':
      return files.filter((file) => file.startsWith('test/compat-harness/'))
    case 'prompt-fixture-corpus':
      return files.filter((file) => file.startsWith('src/ts/process/__fixtures__/') && !file.endsWith('/README.md'))
    case 'snapshot-screenshot':
      return files.filter(
        (file) =>
          file.endsWith('.snap') || /^server\/fastify\/browser-smoke\/.*\.spec\.ts-snapshots\/.*\.png$/.test(file),
      )
    case 'shared-helper-harness': {
      const selected = files.filter(
        (file) =>
          file.startsWith('server/fastify/__tests__/helpers/') ||
          (/^src\/ts\/__tests__\/[^/]+\.ts$/.test(file) && !file.endsWith('.test.ts')) ||
          (/^src\/lib\//.test(file) &&
            !/\.(?:test|spec)\.ts$/.test(file) &&
            (/(?:^|\/)[^/]*test[^/]*\.(?:ts|svelte)$/i.test(file) || file.includes('/testHarness/'))),
      )
      return uniqueSorted([...selected, ...fixedSharedHelperFiles])
    }
  }
}

export function createTestSupportInventoryDocument(rootDir: string): TestSupportInventoryDocument {
  const tracked = trackedFiles(rootDir)
  const trackedSet = new Set(tracked)
  const roles: SupportArtifactRole[] = [
    'runner-config-ci',
    'performance-budget-tooling',
    'compatibility-harness',
    'prompt-fixture-corpus',
    'shared-helper-harness',
    'snapshot-screenshot',
  ]
  const groups = roles.map((role) => ({ role, files: filesForRole(tracked, role) }))
  const standalone = groups.flatMap((group) => group.files)
  const duplicates = standalone.filter((file, index) => standalone.indexOf(file) !== index)
  if (duplicates.length > 0) throw new Error(`Support artifact groups overlap: ${uniqueSorted(duplicates).join(', ')}`)
  const missing = [...standalone, ...mixedProductionTestSeams].filter((file) => !trackedSet.has(file))
  if (missing.length > 0) throw new Error(`Support artifact paths are not tracked: ${uniqueSorted(missing).join(', ')}`)
  const ordinaryTests = standalone.filter((file) => /\.(?:test|spec)\.ts$/.test(file))
  if (ordinaryTests.length > 0) throw new Error(`Ordinary tests cannot be support rows: ${ordinaryTests.join(', ')}`)

  return {
    schemaVersion: TEST_SUPPORT_INVENTORY_SCHEMA_VERSION,
    standaloneCount: standalone.length,
    mixedProductionCount: mixedProductionTestSeams.length,
    groups,
    mixedProductionTestSeams: uniqueSorted(mixedProductionTestSeams),
    intentionalExclusions: [...intentionalExclusions],
  }
}

export function formatTestSupportInventory(document: TestSupportInventoryDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function validateTestSupportInventory(document: TestSupportInventoryDocument): string[] {
  const problems: string[] = []
  if (document.schemaVersion !== TEST_SUPPORT_INVENTORY_SCHEMA_VERSION) problems.push('schemaVersion is invalid')
  const standalone = document.groups.flatMap((group) => group.files)
  if (document.standaloneCount !== standalone.length) problems.push('standaloneCount does not match groups')
  if (new Set(standalone).size !== standalone.length) problems.push('standalone support rows are duplicated')
  if (document.mixedProductionCount !== document.mixedProductionTestSeams.length) {
    problems.push('mixedProductionCount does not match mixedProductionTestSeams')
  }
  if (new Set(document.mixedProductionTestSeams).size !== document.mixedProductionTestSeams.length) {
    problems.push('mixed production seams are duplicated')
  }
  return problems
}

export function writeTestSupportInventory(rootDir: string, outputFile: string): TestSupportInventoryDocument {
  const document = createTestSupportInventoryDocument(rootDir)
  const absoluteOutput = path.resolve(rootDir, outputFile)
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true })
  fs.writeFileSync(absoluteOutput, formatTestSupportInventory(document))
  return document
}

export function checkTestSupportInventory(rootDir: string, inputFile: string): TestSupportInventoryDocument {
  const absoluteInput = path.resolve(rootDir, inputFile)
  if (!fs.existsSync(absoluteInput)) throw new Error(`Missing support inventory: ${inputFile}`)
  const actual = JSON.parse(fs.readFileSync(absoluteInput, 'utf8')) as TestSupportInventoryDocument
  const problems = validateTestSupportInventory(actual)
  if (problems.length > 0) throw new Error(`Invalid support inventory:\n${problems.join('\n')}`)
  const expected = createTestSupportInventoryDocument(rootDir)
  if (formatTestSupportInventory(actual) !== formatTestSupportInventory(expected)) {
    throw new Error(`Test support inventory is stale; regenerate ${inputFile}`)
  }
  return actual
}

function runCli(argv: readonly string[], rootDir = process.cwd()): number {
  if (argv.length !== 2 || (argv[0] !== '--check' && argv[0] !== '--write')) {
    throw new Error('Usage: tsx util/test-support-inventory.ts (--check|--write) <inventory.json>')
  }
  const document =
    argv[0] === '--write' ? writeTestSupportInventory(rootDir, argv[1]) : checkTestSupportInventory(rootDir, argv[1])
  console.log(`Standalone support artifacts: ${document.standaloneCount}`)
  console.log(`Mixed production test seams: ${document.mixedProductionCount}`)
  console.log(`${argv[0] === '--write' ? 'Wrote' : 'Verified'} ${argv[1]}`)
  return 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && fs.existsSync(invokedPath)) {
  try {
    process.exitCode = runCli(process.argv.slice(2))
  } catch (error) {
    console.error(`[test-support-inventory] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
