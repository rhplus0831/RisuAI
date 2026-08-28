import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { frontendVitestProjectForFile } from '../vitest.frontend-routing.js'
import { performanceTestFiles } from '../vitest.performance-tests.js'
import { uiCoverageTestFiles } from '../vitest.ui-coverage-tests.js'

export const TEST_EFFECTIVENESS_INVENTORY_SCHEMA_VERSION = 1 as const

export const primaryCategories = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const
export type PrimaryCategory = (typeof primaryCategories)[number]

export type TestLane = 'frontend-node' | 'frontend-svelte-node' | 'frontend-dom' | 'fastify-node' | 'built-browser'

export type TestCapability = 'N' | 'S' | 'D' | 'Fastify Node' | 'B'

export const testKinds = [
  'pure unit',
  'component/DOM',
  'storage integration',
  'API integration',
  'browser journey',
  'golden/compatibility',
  'property/fuzz',
  'performance/budget',
  'architecture policy',
] as const
export type TestKind = (typeof testKinds)[number]

export const dependencyNames = [
  'mocks',
  'fixtures',
  'timers',
  'network',
  'filesystem',
  'database',
  'globals',
  'browser',
] as const
export type DependencyName = (typeof dependencyNames)[number]

export const valueClasses = [
  'pending',
  'user-visible behavior',
  'data integrity and recovery',
  'protocol and integration',
  'security and safety',
  'compatibility',
  'architecture policy',
  'performance and capacity',
  'diagnostic oracle',
] as const
export type ValueClass = (typeof valueClasses)[number]

export const auditDecisions = [
  'pending',
  'Keep',
  'Strengthen',
  'Merge',
  'Reclassify',
  'Remove',
  'Add',
  'Defer',
] as const
export type AuditDecision = (typeof auditDecisions)[number]

export const findingSeverities = ['pending', 'Critical', 'High', 'Medium', 'Low', 'Informational'] as const
export type FindingSeverity = (typeof findingSeverities)[number]

export const auditConfidences = ['pending', 'high', 'medium', 'low'] as const
export type AuditConfidence = (typeof auditConfidences)[number]

export interface AuditMetadata {
  caseOrMatrixOwner: string
  valueClasses: ValueClass[]
  productionOwnerOrContract: string
  plausibleDefect: string
  risk: string
  companionEvidence: string
  decision: AuditDecision
  confidence: AuditConfidence
  rationale: string
  findingId: string
  severity: FindingSeverity
  action: string
  validation: string
  state: string
}

export interface CollectedCaseCounts {
  cases: number | null
  skipped: number | null
  parameterizedRows: number | null
  source: string
}

export interface CollectedCaseCountMetadata {
  schemaVersion: 1
  source: string
  files: Record<
    string,
    {
      cases: number
      skipped: number
      parameterizedRows: number
    }
  >
}

export interface SupportArtifactLink {
  manifest: string
  standaloneArtifactCount: number | null
  mixedProductionSeamCount: number | null
  state: 'pending' | 'linked'
}

export interface TestEffectivenessInventoryRow {
  file: string
  lane: TestLane
  capability: TestCapability
  specializedOwnership: string[]
  primaryCategory: PrimaryCategory
  categoryRule: string
  seamTags: string[]
  kind: TestKind
  dependencySignals: DependencyName[]
  caseCounts: CollectedCaseCounts
  audit: AuditMetadata
}

export interface DocumentedCategoryRule {
  id: string
  category: PrimaryCategory
  description: string
  pathPatterns: string[]
}

export interface TestEffectivenessInventoryDocument {
  schemaVersion: typeof TEST_EFFECTIVENESS_INVENTORY_SCHEMA_VERSION
  trackedFileCount: number
  categoryRules: DocumentedCategoryRule[]
  supportArtifacts: SupportArtifactLink
  rows: TestEffectivenessInventoryRow[]
}

interface CategoryRule {
  id: string
  category: PrimaryCategory
  description: string
  patterns: readonly RegExp[]
}

// First match wins. The order makes the boundary rules in the audit plan
// executable: infrastructure and security/platform owners win before broad
// product terms; provider behavior wins before generic generation; durable
// recovery wins before generic command/storage; and byte-level Realm/import
// behavior wins before catalog/authoring behavior.
export const categoryRules: readonly CategoryRule[] = [
  {
    id: 'assurance-tooling',
    category: 'A',
    description: 'Test runners, routing, setup, inventories, affected selection, coverage, and build-budget policy.',
    patterns: [
      /^vitest\..*\.test\.ts$/,
      /^packages\/protocol\/src\/importBoundary\.test\.ts$/,
      /^src\/lib\/_audit\/frontendArchitecture\.static\.test\.ts$/,
      /^src\/ts\/alert\.importSafety\.test\.ts$/,
      /^src\/ts\/process\/rawGenerationCallerAllowlist\.test\.ts$/,
      /^src\/ts\/__tests__\/(?:renderCostHarness|sendCloneCountProbe)\.test\.ts$/,
      /^src\/ts\/stores\.importSafety\.svelte\.test\.ts$/,
      /^server\/fastify\/__tests__\/(?:protocolPackage|serverLoadCostHarness|terminalFrameAssertions)\.test\.ts$/,
      /^util\/(?:affected-tests|bundle-boundary-report|check-server|frontend-test-inventory|initial-preload-report|test-all|test-effectiveness-inventory|vite-warning-policy)\.test\.ts$/,
    ],
  },
  {
    id: 'visible-chat-ui',
    category: 'D',
    description:
      'Mounted and browser-shaped ChatScreens behavior is visible chat/UI evidence, even when it invokes generation.',
    patterns: [
      /^src\/lib\/SideBars\/chatGenerationSettingsControls\.test\.ts$/,
      /^src\/lib\/ChatScreens\//,
      /^src\/lang\/index\.test\.ts$/,
      /^src\/ts\/observer\.svelte\.test\.ts$/,
      /^src\/lib\/Others\/alertPromptInfo\.test\.ts$/,
    ],
  },
  {
    id: 'settings-authoring-ui',
    category: 'E',
    description:
      'Settings, provider panels, Realm/catalog, and plugin/module authoring UI stay in the authoring category.',
    patterns: [
      /^src\/lib\/Setting\//,
      /^src\/lib\/UI\/(?:ModelList|NanoGPTDashboard|Realm\/|ScriptModelOverrideSelectors)/,
      /^src\/lib\/UI\/PromptDataItem\.svelte\.test\.ts$/,
      /^src\/ts\/chatGenerationTogglePresets\.test\.ts$/,
      /^src\/ts\/(?:moduleEditor|presetFieldMirror)/,
    ],
  },
  {
    id: 'api-security-runtime',
    category: 'L',
    description:
      'Authentication, authorization, egress and body limits, tracing, startup/shutdown, service workers, and platform routes.',
    patterns: [
      /^server\/fastify\/__tests__\/hub\.test\.ts$/,
      /^server\/fastify\/__tests__\/(?:requestAbort|streamBackpressure)\.test\.ts$/,
      /^src\/ts\/gui\/loginMessageOrigin\.test\.ts$/,
      /(?:^|\/)(?:auth|config|echo|http|index|apiStatus|requestLimits|requestPolicy|ssrf|webPush|pushNotifications|serviceWorker|startupShutdown|shutdown|traceRedaction|tracing|agentDataSandbox)(?:\.|\/)/i,
      /(?:bodyCap|decompression|prototypePollution|routeProtection|security|TraceSidecar|startupTelemetry|runtimeLimits|payloadBudgets|requestTrace|sourcemap|browserLocalSurface|pushNotification|globalApi\.proxy|globalApi\.fetchNative|localNetwork|proxyJobWs|polyfill|\/proxy\.test|\/smoke\.test|\/static\.test|notification\.test)/i,
    ],
  },
  {
    id: 'asset-save-boundary',
    category: 'K',
    description:
      'Asset bytes and ownership, imports/exports, saves, backups, archive codecs, Realm staging, and historical formats.',
    patterns: [
      /^src\/ts\/characterCards\.pngImport\.svelte-node\.test\.ts$/,
      /^src\/ts\/server\/promptPresetIconUpload\.test\.ts$/,
      /^src\/ts\/chatImportPlanning\.test\.ts$/,
      /(?:^|\/)(?:assets?|assetGc|assetMetadataIndex|backups?|saveCodec|saveFiles?|browserFileService|inlayCatalog)(?:\.|\/)/i,
      /(?:realmImport|charx|risuSave|processzip|importChat|exportChat|importPreset|downloadPreset|backupRestore|bundleImport|bundleExport|historicalFormat|compatibilityAdapters|filePicker|globalApi\.(?:downloadFile|getFileSrc|saveAssets)|dynamicutils\/pdf|files\/multisend|files\/tests\/inlays|biasImport|moduleAssetUpload|naiVibeImport|sha256Fallback)/i,
    ],
  },
  {
    id: 'plugin-tool-runtime',
    category: 'J',
    description:
      'Plugin/module permissions and lifecycle, MCP, RisuAccess, Playground, and developer-specialized tools.',
    patterns: [
      /(?:^|\/)(?:plugins?|modules?|mcp|risuaccess|Playground)(?:\.|\/)/i,
      /(?:plugin|module|mcp|risuaccess|playground|analyze-database|devTools|developerTool|nanoGPTDashboard)/i,
    ],
  },
  {
    id: 'scripting-parsing-automation',
    category: 'I',
    description: 'CBS, parsing, regex/display scripts, triggers, Lua, automation, and bounded execution.',
    patterns: [
      /^server\/fastify\/__tests__\/promptVariables\.test\.ts$/,
      /(?:^|\/)(?:parser|scripts?|triggers?|lua|cbs)(?:\.|\/)/i,
      /(?:boundedRegex|regex|editdisplay|displaySource|scriptings?|additionalHtml|htmlParser|automation|trigger|luaRuntime|inputHooks?)/i,
    ],
  },
  {
    id: 'memory-jobs-workers',
    category: 'H',
    description: 'Memory, embeddings, summaries, ranking, jobs, queues, and worker lifecycle.',
    patterns: [
      /(?:^|\/)(?:memory|embeddings?|summaries?|jobs?|workers?|hypa)(?:\.|\/)/i,
      /(?:memory|embedding|summar|ranking|similarity|jobQueue|worker|Hypa|streamJobs)/i,
    ],
  },
  {
    id: 'reviewed-provider-adjacent-authoring-boundaries',
    category: 'E',
    description:
      'Reviewed parameter and character-emotion controls whose dominant contract is settings or character authoring.',
    patterns: [
      /^src\/lib\/Others\/AllSeperateParameters\.svelte\.test\.ts$/,
      /^src\/ts\/characters\.imageEmotion\.test\.ts$/,
    ],
  },
  {
    id: 'reviewed-provider-adjacent-chat-ui-boundaries',
    category: 'D',
    description:
      'Reviewed provider-list and completion-sound owners whose observable contract is mounted or visible UI.',
    patterns: [
      /^src\/lib\/UI\/OpenrouterProviderList\.svelte\.test\.ts$/,
      /^src\/ts\/process\/messageCompletionSound\.test\.ts$/,
    ],
  },
  {
    id: 'reviewed-provider-adjacent-generation-boundaries',
    category: 'F',
    description:
      'Reviewed dispatch, emotion-processing, and client-context owners whose dominant contract is generation orchestration.',
    patterns: [
      /^src\/ts\/process\/__tests__\/(?:dispatchRequest|emotionFallbackLlm|emotionFromResponse)\.test\.ts$/,
      /^src\/ts\/process\/request\/clientContext\.test\.ts$/,
    ],
  },
  {
    id: 'provider-model-media',
    category: 'G',
    description: 'Provider adapters, models and credentials, translation, image/audio/transcription, and media codecs.',
    patterns: [
      /^server\/fastify\/__tests__\/(?:chatDispatchLogitBias|chatDispatchProfileOptions|generation\.completion|openrouterFreeModel|tokenizerConfig|tokenizerGoldenCounts|tokens)\.test\.ts$/,
      /^src\/ts\/tokenizer\.test\.ts$/,
      /(?:^|\/)(?:providers?|models?|credentials?|translator|translation|media|audio|speech|transcription|imageGeneration|compressImage)(?:\.|\/)/i,
      /(?:anthropic|bedrock|cohere|gemini|google|horde|kobold|ollama|openai|ooba|mistral|vertex|sigv4|stableDiff|novelAi|elevenLabs|whisper|provider|modelProfile|credential|translation|translator|imggen|imageEmotion|completionSound|stripCoT|tts|jsonControls|additionalParams|seperateParameters|requestHistory|dispatchRequest|emotionFallback|emotionFromResponse|clientContext|modelRoleRouting|transformers)/i,
    ],
  },
  {
    id: 'reviewed-browser-state-boundaries',
    category: 'B',
    description: 'Reviewed prompt-named owners whose dominant contract is browser hydration and recovery.',
    patterns: [/^src\/ts\/server\/promptTemplateHydration\.test\.ts$/],
  },
  {
    id: 'reviewed-persistence-bridge-boundaries',
    category: 'C',
    description: 'Reviewed generation-settings and prompt-template owners whose dominant contract is durable mutation.',
    patterns: [
      /^src\/ts\/(?:activeChatGenerationSettings|agentPresets|chatGenerationSettings)\.test\.ts$/,
      /^src\/ts\/server\/promptTemplateBridge\.svelte\.test\.ts$/,
    ],
  },
  {
    id: 'prompt-generation-streaming',
    category: 'F',
    description:
      'Prompt assembly, generation operations and effects, streaming, finalization, reroll, and Agent Presets.',
    patterns: [
      /^server\/fastify\/__tests__\/lorebook\.test\.ts$/,
      /^src\/ts\/agentLorebookInputs\.test\.ts$/,
      /^src\/ts\/process\/request\/tests\/serverChat\.test\.ts$/,
      /(?:^|\/)(?:generation|prompting|prompts?|streaming|agentPresets?)(?:\.|\/)/i,
      /(?:assemble|generation|sendChat|prompt|streamResponse|nonStreamResponse|orchestrateResponse|durableGeneration|reroll|preflight|runStage|stage4|agentPreset|budgetFinalize|formatHistory|lorebookContext|acceptedSend|plainSections|staticSections|streamBackpressure|templates|tokens?(?:\.test)|tokenizer|buildDescription|buildHistoryWindow|charEmotionStore|normalizeTemplate|reattach|finalizeRequestBudget|streamCoalescer|halfStreamingProgress|inlayFinalization|serverMessagePatch|sseParse|serverCompletion|requestAbort|history\.test|\/igp\.test)/i,
    ],
  },
  {
    id: 'browser-state-recovery',
    category: 'B',
    description:
      'Browser bootstrap, writer/observer state, outbox/replay, hydration, invalidation, refresh, and recovery.',
    patterns: [
      /^src\/ts\/server\/chatMessageHydration(?:\.reactivity\.svelte)?\.test\.ts$/,
      /(?:^|\/)(?:bootstrap|recovery|hydration|invalidation|outbox|replay|startupReadiness)(?:\.|\/)/i,
      /(?:activeWriter|observer|pendingMutation|lifecycleRecovery|startupRecovery|resourceState|resourceRefresh|resourceInvalidation|resourceCache|resourceManifest|cachePopulation|visibleStateRecovery|routeResourceLoader|preload|entryStartup|hydrationReads|shellHydration|shellProtocol|staleStateGuards|stores\.runtimeEffects)/i,
    ],
  },
  {
    id: 'persistence-command-bridge',
    category: 'C',
    description:
      'SQLite persistence, revisions and receipts, commands/events, durable mutations, repositories, and editing bridges.',
    patterns: [
      /(?:^|\/)(?:database|storage|commands?|events?|migrations?|repositories?|bridges?)(?:\.|\/)/i,
      /(?:database|sqlite|command|revision|receipt|mutation|persistence|repository|identityRepair|bridge|messageStore|resourceWrite|resourceReads|collectionRange|floorUnblock|idempotency|legacyStorage|coldstorage|\/db\.test)/i,
    ],
  },
  {
    id: 'settings-authoring-catalog',
    category: 'E',
    description: 'Settings UI, profiles, personas, characters, lorebook authoring, catalogs, loadouts, and reordering.',
    patterns: [
      /(?:^|\/)(?:Setting|settings?|characters?|persona|lorebooks?|catalogs?|loadouts?)(?:\.|\/)/,
      /(?:Settings|character|persona|lorebook|catalog|loadout|picker|reorder|presets|authoring|colorscheme|languageSettings|\/hub\.test)/i,
    ],
  },
  {
    id: 'app-chat-shared-ui',
    category: 'D',
    description:
      'Navigation, visible chat behavior, sidebars, shared UI feedback, focus, accessibility, and responsive behavior.',
    patterns: [
      /(?:^|\/)(?:ChatScreens|SideBars|Others|gui|router|hotkey|navigation|shared-ui)(?:\.|\/)/i,
      /(?:chat|composer|sidebar|navigation|router|alert|modal|focus|accessib|viewport|scroll|touch|dragTypes|animation|dropList|icon|App\.|optimisticTogglePaint|^src\/lib\/(?:Mobile|UI)\/|fastifyBrowserSmoke|lazyFirstOpen)/i,
    ],
  },
] as const

const performanceFileSet = new Set<string>(performanceTestFiles)
const uiCoverageFileSet = new Set<string>(uiCoverageTestFiles)
const testFilePattern = /\.(?:test|spec)\.ts$/

const dependencyPatterns: Readonly<Record<DependencyName, readonly RegExp[]>> = {
  mocks: [/\bvi\.(?:mock|doMock|fn|spyOn|stubGlobal)\b/, /\bmock[A-Z][A-Za-z0-9_]*\b/, /__mocks__/],
  fixtures: [/(?:^|[/'".])(?:fixtures?|goldens?)(?:[/'".]|$)/i, /\bfixture[A-Z_][A-Za-z0-9_]*\b/],
  timers: [
    /\b(?:setTimeout|setInterval|clearTimeout|clearInterval|requestAnimationFrame)\s*\(/,
    /\bvi\.(?:useFakeTimers|advanceTimersByTime|advanceTimersToNextTimer|runAllTimers|runOnlyPendingTimers)\b/,
  ],
  network: [/\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*(?:\.|\()/, /\b(?:app|server)\.inject\s*\(/],
  filesystem: [
    /from\s*['"]node:(?:fs|fs\/promises|path|os)['"]|require\s*\(\s*['"]node:(?:fs|fs\/promises|path|os)['"]\s*\)/,
    /\b(?:mkdtemp|readFile|writeFile|rmSync|mkdirSync|copyFile|readdir)\w*\s*\(/,
  ],
  database: [/\b(?:sqlite|better-sqlite3|database|Database|Repository|repository|db\.)\b/, /\/storage\/database/],
  globals: [
    /\b(?:globalThis|process\.env|vi\.stubGlobal)\b/,
    /Object\.defineProperty\s*\(\s*(?:global|globalThis|window)/,
  ],
  browser: [
    /\b(?:document|window|navigator|HTMLElement|SVGElement|localStorage|sessionStorage|indexedDB|MutationObserver|ResizeObserver)\b/,
    /@testing-library\/svelte|@playwright\/test|\bpage\.(?:goto|reload|locator|evaluate|click|fill)\b/,
  ],
}

const auditMetadataKeys = [
  'caseOrMatrixOwner',
  'valueClasses',
  'productionOwnerOrContract',
  'plausibleDefect',
  'risk',
  'companionEvidence',
  'decision',
  'confidence',
  'rationale',
  'findingId',
  'severity',
  'action',
  'validation',
  'state',
] as const satisfies readonly (keyof AuditMetadata)[]

const rowKeys = [
  'file',
  'lane',
  'capability',
  'specializedOwnership',
  'primaryCategory',
  'categoryRule',
  'seamTags',
  'kind',
  'dependencySignals',
  'caseCounts',
  'audit',
] as const satisfies readonly (keyof TestEffectivenessInventoryRow)[]

function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

function compareRepoPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function sourceMatches(source: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(source)
  })
}

export function documentedCategoryRules(): DocumentedCategoryRule[] {
  const explicit = categoryRules.map((rule) => ({
    id: rule.id,
    category: rule.category,
    description: `First matching rule wins. ${rule.description}`,
    pathPatterns: rule.patterns.map((pattern) => pattern.toString()),
  }))
  return [
    ...explicit,
    {
      id: 'fallback-browser-or-dom',
      category: 'D',
      description: 'A path unmatched above uses D when its resolved lane is built-browser or frontend-dom.',
      pathPatterns: [],
    },
    {
      id: 'fallback-fastify',
      category: 'L',
      description: 'A path unmatched above uses L when its resolved lane is fastify-node.',
      pathPatterns: [],
    },
    {
      id: 'fallback-frontend-node',
      category: 'A',
      description: 'Any remaining tracked frontend N/S path uses A and remains explicitly visible for Phase 1 review.',
      pathPatterns: [],
    },
  ]
}

export function discoverTrackedTestFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z', '--', '*.test.ts', '*.spec.ts'], {
    cwd: rootDir,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'git ls-files failed')
  }

  const files = result.stdout
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepoPath)
    .filter((file) => testFilePattern.test(file))
    .sort(compareRepoPaths)
  if (!isUnique(files)) throw new Error('git ls-files returned duplicate test paths')
  return files
}

export function laneForTestFile(file: string): { lane: TestLane; capability: TestCapability } {
  if (/^server\/fastify\/browser-smoke\/.*\.spec\.ts$/.test(file)) {
    return { lane: 'built-browser', capability: 'B' }
  }
  if (/^server\/fastify\/__tests__\/.*\.test\.ts$/.test(file)) {
    return { lane: 'fastify-node', capability: 'Fastify Node' }
  }

  const project = frontendVitestProjectForFile(file)
  if (project === 'frontend-node') return { lane: project, capability: 'N' }
  if (project === 'frontend-svelte-node') return { lane: project, capability: 'S' }
  if (project === 'frontend-dom') return { lane: project, capability: 'D' }
  throw new Error(`Tracked test is not owned by a known lane: ${file}`)
}

export function categoryForTestFile(
  file: string,
  lane: TestLane = laneForTestFile(file).lane,
): { category: PrimaryCategory; ruleId: string } {
  for (const rule of categoryRules) {
    if (sourceMatches(file, rule.patterns)) return { category: rule.category, ruleId: rule.id }
  }
  if (lane === 'built-browser' || lane === 'frontend-dom') {
    return { category: 'D', ruleId: 'fallback-browser-or-dom' }
  }
  if (lane === 'fastify-node') return { category: 'L', ruleId: 'fallback-fastify' }
  return { category: 'A', ruleId: 'fallback-frontend-node' }
}

export function dependencySignalsForSource(source: string): DependencyName[] {
  return dependencyNames.filter((name) => sourceMatches(source, dependencyPatterns[name]))
}

function specializedOwnership(file: string, lane: TestLane): string[] {
  if (lane === 'built-browser') return ['browser-smoke']
  if (lane === 'fastify-node') {
    return file === 'server/fastify/__tests__/realmImport.test.ts' ? ['server', 'realm-scale-gate'] : ['server']
  }

  const owners = ['full-frontend', 'broad-frontend-coverage']
  if (!performanceFileSet.has(file)) owners.push('ordinary-frontend')
  if (!performanceFileSet.has(file) && !uiCoverageFileSet.has(file)) owners.push('test-all-ordinary-frontend')
  if (performanceFileSet.has(file)) owners.push('performance-gate')
  if (uiCoverageFileSet.has(file)) owners.push('ui-map-coverage')
  if (file.startsWith('src/lib/_audit/')) owners.push('ui-audit-gate')
  return owners
}

function seamTagsForRow(
  file: string,
  source: string,
  lane: TestLane,
  primaryCategory: PrimaryCategory,
  dependencies: readonly DependencyName[],
): string[] {
  const tags: string[] = []
  if (lane === 'built-browser') tags.push('browser-client-fastify-sqlite')
  if (lane === 'frontend-dom') tags.push('dom-component')
  if (lane.startsWith('frontend-') && /server\/fastify|app\.inject|buildApp/.test(source)) tags.push('client-fastify')
  if (dependencies.includes('network') && dependencies.includes('database')) tags.push('api-persistence')
  if (performanceFileSet.has(file)) tags.push('performance-gate')
  if (uiCoverageFileSet.has(file)) tags.push('coverage-gate')
  const secondaryCategories = new Set(
    categoryRules
      .filter((rule) => rule.category !== primaryCategory && sourceMatches(file, rule.patterns))
      .map((rule) => `category-${rule.category}`),
  )
  tags.push(...secondaryCategories)
  return tags.sort()
}

function kindForRow(
  file: string,
  source: string,
  lane: TestLane,
  category: PrimaryCategory,
  dependencies: readonly DependencyName[],
): TestKind {
  if (performanceFileSet.has(file)) return 'performance/budget'
  if (lane === 'built-browser') return 'browser journey'
  if (/fast-check|\bfc\.(?:property|asyncProperty)\b/.test(source)) return 'property/fuzz'
  if (/(?:^|\/)(?:fixtures?|goldens?)(?:\.|\/)|compatibility/i.test(file)) return 'golden/compatibility'
  if (category === 'A') return 'architecture policy'
  if (lane === 'frontend-dom') return 'component/DOM'
  if (dependencies.includes('database')) return 'storage integration'
  if (lane === 'fastify-node' && /\b(?:app|server)\.inject\s*\(|\bbuildApp\s*\(/.test(source)) {
    return 'API integration'
  }
  return 'pure unit'
}

export function pendingAuditMetadata(): AuditMetadata {
  return {
    caseOrMatrixOwner: 'pending',
    valueClasses: ['pending'],
    productionOwnerOrContract: 'pending',
    plausibleDefect: 'pending',
    risk: 'pending',
    companionEvidence: 'pending',
    decision: 'pending',
    confidence: 'pending',
    rationale: 'pending',
    findingId: '',
    severity: 'pending',
    action: 'pending',
    validation: 'pending',
    state: 'pending',
  }
}

export function pendingCollectedCaseCounts(): CollectedCaseCounts {
  return { cases: null, skipped: null, parameterizedRows: null, source: 'pending' }
}

export function pendingSupportArtifactLink(): SupportArtifactLink {
  return {
    manifest: 'pending',
    standaloneArtifactCount: null,
    mixedProductionSeamCount: null,
    state: 'pending',
  }
}

function normalizeMetadataFile(rootDir: string, file: string): string {
  const relative = path.isAbsolute(file) ? path.relative(rootDir, file) : file
  const normalized = normalizeRepoPath(relative)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Case-count path escapes the repository: ${file}`)
  }
  return normalized
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

export function parseCollectedCaseCountMetadata(value: unknown, rootDir: string): Map<string, CollectedCaseCounts> {
  if (!isRecord(value) || !exactKeys(value, ['schemaVersion', 'source', 'files'])) {
    throw new Error('Case-count metadata must contain exactly schemaVersion, source, and files')
  }
  if (value.schemaVersion !== 1) throw new Error('Case-count metadata schemaVersion must be 1')
  if (typeof value.source !== 'string' || value.source.trim() === '') {
    throw new Error('Case-count metadata source must be non-empty')
  }
  if (!isRecord(value.files)) throw new Error('Case-count metadata files must be an object keyed by test path')

  const result = new Map<string, CollectedCaseCounts>()
  for (const [rawFile, counts] of Object.entries(value.files)) {
    const file = normalizeMetadataFile(rootDir, rawFile)
    if (!testFilePattern.test(file)) throw new Error(`Case-count metadata has an invalid test path: ${rawFile}`)
    if (result.has(file)) throw new Error(`Case-count metadata has a duplicate normalized path: ${file}`)
    if (!isRecord(counts) || !exactKeys(counts, ['cases', 'skipped', 'parameterizedRows'])) {
      throw new Error(`Case-count metadata for ${file} has missing or unexpected fields`)
    }
    if (!nonNegativeInteger(counts.cases)) throw new Error(`Case-count metadata cases must be non-negative: ${file}`)
    if (!nonNegativeInteger(counts.skipped)) {
      throw new Error(`Case-count metadata skipped must be non-negative: ${file}`)
    }
    if (!nonNegativeInteger(counts.parameterizedRows)) {
      throw new Error(`Case-count metadata parameterizedRows must be non-negative: ${file}`)
    }
    if (counts.skipped > counts.cases) throw new Error(`Case-count metadata skipped exceeds cases: ${file}`)
    result.set(file, {
      cases: counts.cases,
      skipped: counts.skipped,
      parameterizedRows: counts.parameterizedRows,
      source: value.source,
    })
  }
  return result
}

export function loadCollectedCaseCountMetadata(rootDir: string, inputFile: string): Map<string, CollectedCaseCounts> {
  const absoluteInput = path.resolve(rootDir, inputFile)
  let value: unknown
  try {
    value = JSON.parse(fs.readFileSync(absoluteInput, 'utf8'))
  } catch (error) {
    throw new Error(
      `Cannot parse case-count metadata ${inputFile}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return parseCollectedCaseCountMetadata(value, rootDir)
}

export function createTestEffectivenessInventoryRow(
  file: string,
  source: string,
  audit: AuditMetadata = pendingAuditMetadata(),
  caseCounts: CollectedCaseCounts = pendingCollectedCaseCounts(),
): TestEffectivenessInventoryRow {
  const normalizedFile = normalizeRepoPath(file)
  const { lane, capability } = laneForTestFile(normalizedFile)
  const { category, ruleId } = categoryForTestFile(normalizedFile, lane)
  const dependencies = dependencySignalsForSource(source)
  return {
    file: normalizedFile,
    lane,
    capability,
    specializedOwnership: specializedOwnership(normalizedFile, lane),
    primaryCategory: category,
    categoryRule: ruleId,
    seamTags: seamTagsForRow(normalizedFile, source, lane, category, dependencies),
    kind: kindForRow(normalizedFile, source, lane, category, dependencies),
    dependencySignals: dependencies,
    caseCounts,
    audit,
  }
}

export function createTestEffectivenessInventoryDocument(
  rootDir: string,
  previousAudits: ReadonlyMap<string, AuditMetadata> = new Map(),
  caseCounts: ReadonlyMap<string, CollectedCaseCounts> = new Map(),
  supportArtifacts: SupportArtifactLink = pendingSupportArtifactLink(),
): TestEffectivenessInventoryDocument {
  const files = discoverTrackedTestFiles(rootDir)
  const fileSet = new Set(files)
  const unexpectedCaseCounts = [...caseCounts.keys()].filter((file) => !fileSet.has(file)).sort(compareRepoPaths)
  if (unexpectedCaseCounts.length > 0) {
    throw new Error(`Case-count metadata has untracked or unsupported files: ${unexpectedCaseCounts.join(', ')}`)
  }
  const rows = files.map((file) =>
    createTestEffectivenessInventoryRow(
      file,
      fs.readFileSync(path.join(rootDir, file), 'utf8'),
      previousAudits.get(file) ?? pendingAuditMetadata(),
      caseCounts.get(file) ?? pendingCollectedCaseCounts(),
    ),
  )
  return {
    schemaVersion: TEST_EFFECTIVENESS_INVENTORY_SCHEMA_VERSION,
    trackedFileCount: rows.length,
    categoryRules: documentedCategoryRules(),
    supportArtifacts,
    rows,
  }
}

export function formatTestEffectivenessInventory(document: TestEffectivenessInventoryDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function validateAuditMetadata(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label} must be an object`]
  const problems: string[] = []
  if (!exactKeys(value, auditMetadataKeys)) problems.push(`${label} has missing or unexpected fields`)

  const requiredText = [
    'caseOrMatrixOwner',
    'productionOwnerOrContract',
    'plausibleDefect',
    'risk',
    'companionEvidence',
    'rationale',
    'action',
    'validation',
    'state',
  ] as const
  for (const key of requiredText) {
    if (typeof value[key] !== 'string' || value[key].trim() === '') problems.push(`${label}.${key} must be non-empty`)
  }
  if (typeof value.findingId !== 'string') problems.push(`${label}.findingId must be a string`)

  if (!isStringArray(value.valueClasses) || value.valueClasses.length === 0 || !isUnique(value.valueClasses)) {
    problems.push(`${label}.valueClasses must be a non-empty unique string array`)
  } else {
    const allowed = new Set<string>(valueClasses)
    const invalid = value.valueClasses.filter((entry) => !allowed.has(entry))
    if (invalid.length > 0) problems.push(`${label}.valueClasses has invalid values: ${invalid.join(', ')}`)
    if (value.valueClasses.includes('pending') && value.valueClasses.length > 1) {
      problems.push(`${label}.valueClasses cannot combine pending with reviewed values`)
    }
  }

  if (!auditDecisions.includes(value.decision as AuditDecision)) problems.push(`${label}.decision is invalid`)
  if (!auditConfidences.includes(value.confidence as AuditConfidence)) problems.push(`${label}.confidence is invalid`)
  if (!findingSeverities.includes(value.severity as FindingSeverity)) problems.push(`${label}.severity is invalid`)
  return problems
}

function validateCollectedCaseCounts(value: unknown, label: string): string[] {
  if (!isRecord(value) || !exactKeys(value, ['cases', 'skipped', 'parameterizedRows', 'source'])) {
    return [`${label} has missing or unexpected fields`]
  }
  const problems: string[] = []
  if (typeof value.source !== 'string' || value.source.trim() === '') problems.push(`${label}.source must be non-empty`)
  const countValues = [value.cases, value.skipped, value.parameterizedRows]
  const allPending = countValues.every((entry) => entry === null)
  const allCollected = countValues.every(nonNegativeInteger)
  if (!allPending && !allCollected) problems.push(`${label} counts must be all null or all non-negative integers`)
  if (allPending && value.source !== 'pending') problems.push(`${label} null counts must use source pending`)
  if (allCollected && value.source === 'pending') problems.push(`${label} collected counts require a named source`)
  if (allCollected && (value.skipped as number) > (value.cases as number)) {
    problems.push(`${label}.skipped cannot exceed cases`)
  }
  return problems
}

function validateSupportArtifactLink(value: unknown): string[] {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['manifest', 'standaloneArtifactCount', 'mixedProductionSeamCount', 'state'])
  ) {
    return ['supportArtifacts has missing or unexpected fields']
  }
  const problems: string[] = []
  if (typeof value.manifest !== 'string' || value.manifest.trim() === '') {
    problems.push('supportArtifacts.manifest must be non-empty')
  }
  if (value.state !== 'pending' && value.state !== 'linked') problems.push('supportArtifacts.state is invalid')
  for (const key of ['standaloneArtifactCount', 'mixedProductionSeamCount'] as const) {
    if (value[key] !== null && !nonNegativeInteger(value[key])) {
      problems.push(`supportArtifacts.${key} must be null or a non-negative integer`)
    }
  }
  if (
    value.state === 'linked' &&
    (value.manifest === 'pending' ||
      !nonNegativeInteger(value.standaloneArtifactCount) ||
      !nonNegativeInteger(value.mixedProductionSeamCount))
  ) {
    problems.push('linked supportArtifacts require a manifest and both counts')
  }
  return problems
}

export function validateTestEffectivenessInventory(value: unknown): string[] {
  if (!isRecord(value)) return ['inventory must be an object']
  const problems: string[] = []
  if (!exactKeys(value, ['schemaVersion', 'trackedFileCount', 'categoryRules', 'supportArtifacts', 'rows'])) {
    problems.push('inventory has missing or unexpected top-level fields')
  }
  if (value.schemaVersion !== TEST_EFFECTIVENESS_INVENTORY_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${TEST_EFFECTIVENESS_INVENTORY_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(value.rows)) return [...problems, 'rows must be an array']
  if (!Number.isInteger(value.trackedFileCount) || (value.trackedFileCount as number) < 0) {
    problems.push('trackedFileCount must be a non-negative integer')
  } else if (value.trackedFileCount !== value.rows.length) {
    problems.push('trackedFileCount does not match rows.length')
  }
  problems.push(...validateSupportArtifactLink(value.supportArtifacts))

  const files: string[] = []
  const lanes = new Set<TestLane>([
    'frontend-node',
    'frontend-svelte-node',
    'frontend-dom',
    'fastify-node',
    'built-browser',
  ])
  const capabilities = new Set<TestCapability>(['N', 'S', 'D', 'Fastify Node', 'B'])
  const categories = new Set<string>(primaryCategories)
  const kinds = new Set<string>(testKinds)
  const dependencies = new Set<string>(dependencyNames)
  const ruleCategories = new Map<string, string>()

  if (!Array.isArray(value.categoryRules)) {
    problems.push('categoryRules must be an array')
  } else {
    value.categoryRules.forEach((ruleValue, index) => {
      const label = `categoryRules[${index}]`
      if (!isRecord(ruleValue)) {
        problems.push(`${label} must be an object`)
        return
      }
      if (!exactKeys(ruleValue, ['id', 'category', 'description', 'pathPatterns'])) {
        problems.push(`${label} has missing or unexpected fields`)
      }
      if (typeof ruleValue.id !== 'string' || ruleValue.id === '') {
        problems.push(`${label}.id must be non-empty`)
      } else if (ruleCategories.has(ruleValue.id)) {
        problems.push(`${label}.id is duplicated: ${ruleValue.id}`)
      } else if (typeof ruleValue.category === 'string') {
        ruleCategories.set(ruleValue.id, ruleValue.category)
      }
      if (!categories.has(ruleValue.category as string)) problems.push(`${label}.category is invalid`)
      if (typeof ruleValue.description !== 'string' || ruleValue.description === '') {
        problems.push(`${label}.description must be non-empty`)
      }
      if (!isStringArray(ruleValue.pathPatterns)) problems.push(`${label}.pathPatterns must be a string array`)
    })
  }

  value.rows.forEach((rowValue, index) => {
    const label = `rows[${index}]`
    if (!isRecord(rowValue)) {
      problems.push(`${label} must be an object`)
      return
    }
    if (!exactKeys(rowValue, rowKeys)) problems.push(`${label} has missing or unexpected fields`)
    if (typeof rowValue.file !== 'string' || !testFilePattern.test(rowValue.file)) {
      problems.push(`${label}.file must be a normalized *.test.ts or *.spec.ts path`)
    } else {
      files.push(rowValue.file)
      if (rowValue.file !== normalizeRepoPath(rowValue.file)) problems.push(`${label}.file is not normalized`)
    }
    if (!lanes.has(rowValue.lane as TestLane)) problems.push(`${label}.lane is invalid`)
    if (!capabilities.has(rowValue.capability as TestCapability)) problems.push(`${label}.capability is invalid`)
    if (!categories.has(rowValue.primaryCategory as string)) problems.push(`${label}.primaryCategory is invalid`)
    if (typeof rowValue.categoryRule !== 'string' || rowValue.categoryRule === '') {
      problems.push(`${label}.categoryRule must be non-empty`)
    } else if (!ruleCategories.has(rowValue.categoryRule)) {
      problems.push(`${label}.categoryRule is not documented`)
    } else if (ruleCategories.get(rowValue.categoryRule) !== rowValue.primaryCategory) {
      problems.push(`${label}.categoryRule does not produce primaryCategory`)
    }
    if (!kinds.has(rowValue.kind as string)) problems.push(`${label}.kind is invalid`)
    for (const key of ['specializedOwnership', 'seamTags', 'dependencySignals'] as const) {
      const entries = rowValue[key]
      if (!isStringArray(entries) || !isUnique(entries)) problems.push(`${label}.${key} must be a unique string array`)
    }
    if (isStringArray(rowValue.dependencySignals)) {
      const invalid = rowValue.dependencySignals.filter((entry) => !dependencies.has(entry))
      if (invalid.length > 0) problems.push(`${label}.dependencySignals has invalid values: ${invalid.join(', ')}`)
    }
    problems.push(...validateCollectedCaseCounts(rowValue.caseCounts, `${label}.caseCounts`))
    problems.push(...validateAuditMetadata(rowValue.audit, `${label}.audit`))
  })

  if (!isUnique(files)) problems.push('rows contain duplicate file paths')
  if (files.some((file, index) => index > 0 && compareRepoPaths(files[index - 1], file) >= 0)) {
    problems.push('rows must be strictly sorted by file')
  }
  return problems
}

function parseInventoryFile(file: string): TestEffectivenessInventoryDocument {
  let value: unknown
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot parse inventory ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const problems = validateTestEffectivenessInventory(value)
  if (problems.length > 0) throw new Error(`Invalid inventory ${file}:\n${problems.join('\n')}`)
  return value as unknown as TestEffectivenessInventoryDocument
}

function machineProjection(document: TestEffectivenessInventoryDocument): unknown {
  return {
    schemaVersion: document.schemaVersion,
    trackedFileCount: document.trackedFileCount,
    categoryRules: document.categoryRules,
    supportArtifacts: document.supportArtifacts,
    rows: document.rows.map(({ audit: _audit, ...row }) => row),
  }
}

export function writeTestEffectivenessInventory(
  rootDir: string,
  outputFile: string,
  caseCountMetadataFile?: string,
): TestEffectivenessInventoryDocument {
  const absoluteOutput = path.resolve(rootDir, outputFile)
  let previousAudits = new Map<string, AuditMetadata>()
  let previousCaseCounts = new Map<string, CollectedCaseCounts>()
  let supportArtifacts = pendingSupportArtifactLink()
  if (fs.existsSync(absoluteOutput)) {
    const previous = parseInventoryFile(absoluteOutput)
    const trackedFiles = new Set(discoverTrackedTestFiles(rootDir))
    const retainedRows = previous.rows.filter((row) => trackedFiles.has(row.file))
    previousAudits = new Map(retainedRows.map((row) => [row.file, row.audit]))
    previousCaseCounts = new Map(retainedRows.map((row) => [row.file, row.caseCounts]))
    supportArtifacts = previous.supportArtifacts
  }
  const caseCounts = new Map(previousCaseCounts)
  if (caseCountMetadataFile) {
    for (const [file, counts] of loadCollectedCaseCountMetadata(rootDir, caseCountMetadataFile)) {
      caseCounts.set(file, counts)
    }
  }
  const document = createTestEffectivenessInventoryDocument(rootDir, previousAudits, caseCounts, supportArtifacts)
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true })
  fs.writeFileSync(absoluteOutput, formatTestEffectivenessInventory(document))
  return document
}

export function checkTestEffectivenessInventory(
  rootDir: string,
  inputFile: string,
  caseCountMetadataFile?: string,
): TestEffectivenessInventoryDocument {
  const absoluteInput = path.resolve(rootDir, inputFile)
  if (!fs.existsSync(absoluteInput)) throw new Error(`Missing inventory: ${inputFile}`)
  const actual = parseInventoryFile(absoluteInput)
  if (actual.supportArtifacts.state === 'linked') {
    const supportManifest = path.resolve(rootDir, actual.supportArtifacts.manifest)
    if (!fs.existsSync(supportManifest)) {
      throw new Error(`Missing linked support-artifact manifest: ${actual.supportArtifacts.manifest}`)
    }
  }
  const caseCounts = new Map(actual.rows.map((row) => [row.file, row.caseCounts]))
  if (caseCountMetadataFile) {
    for (const [file, counts] of loadCollectedCaseCountMetadata(rootDir, caseCountMetadataFile)) {
      caseCounts.set(file, counts)
    }
  }
  const expected = createTestEffectivenessInventoryDocument(rootDir, new Map(), caseCounts, actual.supportArtifacts)
  if (JSON.stringify(machineProjection(actual)) !== JSON.stringify(machineProjection(expected))) {
    throw new Error(`Test effectiveness inventory is stale; regenerate ${inputFile}`)
  }
  return actual
}

function inventorySummary(document: TestEffectivenessInventoryDocument): string {
  const laneCounts = new Map<TestLane, number>()
  const categoryCounts = new Map<PrimaryCategory, number>()
  for (const row of document.rows) {
    laneCounts.set(row.lane, (laneCounts.get(row.lane) ?? 0) + 1)
    categoryCounts.set(row.primaryCategory, (categoryCounts.get(row.primaryCategory) ?? 0) + 1)
  }
  return [
    `Tracked tests: ${document.trackedFileCount}`,
    `Lanes: ${[...laneCounts].map(([lane, count]) => `${lane}=${count}`).join(', ')}`,
    `Categories: ${primaryCategories.map((category) => `${category}=${categoryCounts.get(category) ?? 0}`).join(', ')}`,
  ].join('\n')
}

interface CliOptions {
  mode: 'check' | 'write'
  file: string
  caseCountMetadataFile?: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  if (
    (argv.length !== 2 && argv.length !== 4) ||
    (argv[0] !== '--check' && argv[0] !== '--write') ||
    (argv.length === 4 && argv[2] !== '--case-counts')
  ) {
    throw new Error(
      'Usage: tsx util/test-effectiveness-inventory.ts (--check|--write) <inventory.json> [--case-counts <case-counts.json>]',
    )
  }
  return {
    mode: argv[0] === '--check' ? 'check' : 'write',
    file: argv[1],
    caseCountMetadataFile: argv[3],
  }
}

export function runTestEffectivenessInventoryCli(argv: readonly string[], rootDir = process.cwd()): number {
  const options = parseCliOptions(argv)
  const document =
    options.mode === 'write'
      ? writeTestEffectivenessInventory(rootDir, options.file, options.caseCountMetadataFile)
      : checkTestEffectivenessInventory(rootDir, options.file, options.caseCountMetadataFile)
  console.log(inventorySummary(document))
  console.log(`${options.mode === 'write' ? 'Wrote' : 'Verified'} ${options.file}`)
  return 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && fs.existsSync(invokedPath)) {
  try {
    process.exitCode = runTestEffectivenessInventoryCli(process.argv.slice(2))
  } catch (error) {
    console.error(`[test-effectiveness-inventory] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
