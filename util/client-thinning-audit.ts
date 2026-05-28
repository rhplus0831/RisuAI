import fs from 'node:fs'
import path from 'node:path'
import { Node, Project, SourceFile, SyntaxKind, type FunctionDeclaration } from 'ts-morph'

interface Finding {
  check: string
  message: string
  file?: string
  line?: number
}

interface AuditCheck {
  id: string
  run: () => void
}

interface RouteRegistration {
  method: string
  route: string
  file: string
  line: number
}

type MutatingRouteKind =
  | 'active-writer'
  | 'auth-session'
  | 'read-only-post'
  | 'runtime-generation'
  | 'runtime-proxy'
  | 'stateless-helper'

interface MutatingRouteRule {
  methods?: string[]
  route?: string
  routePrefix?: string
  kind: MutatingRouteKind
  reason: string
  activeWriterNeedles?: string[]
}

interface AssetWalkerField {
  collector: string
  value: string
  path: string
}

interface AssetWalkerOwner {
  collector: string
  value: string
  path: string
  owner: string
  validatorFile: string
  validatorNeedles: string[]
}

const root = process.cwd()
const project = new Project({
  tsConfigFilePath: path.join(root, 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
})

const sourcePaths = [
  'server/fastify/src/app.ts',
  'server/fastify/src/activeWriter.ts',
  'server/fastify/src/repository.ts',
  'server/fastify/src/routes/**/*.ts',
  'server/fastify/src/commands/**/*.ts',
  'server/fastify/src/risuSave/assetReferences.ts',
  'server/fastify/src/risuSave/exportSnapshot.ts',
  'server/fastify/src/risuSave/importSnapshot.ts',
  'src/ts/server/commands.ts',
  'src/ts/plugins/pluginSafeClass.ts',
  'src/ts/plugins/plugins.svelte.ts',
  'src/ts/plugins/apiV3/v3.svelte.ts',
  'src/ts/process/request/serverCompletion.ts',
  'src/ts/process/request/serverChat.ts',
  'src/ts/process/request/serverMemory.ts',
  'src/ts/process/request/request.ts',
  'src/ts/process/request/google.ts',
  'src/ts/server/projectionWriteGuard.svelte.ts',
]

project.addSourceFilesAtPaths(sourcePaths.map((pattern) => path.join(root, pattern)))

const findings: Finding[] = []

function rel(file: SourceFile | string): string {
  const filePath = typeof file === 'string' ? file : file.getFilePath()
  return path.relative(root, filePath).replaceAll(path.sep, '/')
}

function source(relativePath: string): SourceFile {
  const absolutePath = path.join(root, relativePath)
  const file = project.getSourceFile(absolutePath)
  if (!file) {
    throw new Error(`Audit source not loaded: ${relativePath}`)
  }
  return file
}

function text(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8')
}

function fail(check: string, message: string, node?: Node, file?: SourceFile | string): void {
  const targetFile = node?.getSourceFile() ?? file
  const pos = node ? node.getSourceFile().getLineAndColumnAtPos(node.getStart()) : undefined
  findings.push({
    check,
    message,
    file: targetFile ? rel(targetFile) : undefined,
    line: pos?.line,
  })
}

function assertCheck(check: string, condition: boolean, message: string, node?: Node): void {
  if (!condition) fail(check, message, node)
}

function getStringArray(sourceFile: SourceFile, name: string): string[] {
  const declaration = sourceFile.getVariableDeclaration(name)
  let initializer = declaration?.getInitializer()
  while (initializer && Node.isAsExpression(initializer)) {
    initializer = initializer.getExpression()
  }
  const array =
    initializer?.asKind(SyntaxKind.ArrayLiteralExpression) ??
    initializer
      ?.asKind(SyntaxKind.NewExpression)
      ?.getArguments()[0]
      ?.asKind(SyntaxKind.ArrayLiteralExpression)
  if (!array) return []
  return array
    .getElements()
    .map((element) => element.asKind(SyntaxKind.StringLiteral)?.getLiteralText())
    .filter((value): value is string => typeof value === 'string')
}

function propertyInitializer(node: Node, name: string): Node | undefined {
  if (!Node.isObjectLiteralExpression(node)) return undefined
  for (const property of node.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue
    const nameNode = property.getNameNode()
    const propertyName = Node.isStringLiteral(nameNode)
      ? nameNode.getLiteralText()
      : nameNode.getText()
    if (propertyName === name) return property.getInitializer()
  }
  return undefined
}

function routeStringFromInitializer(initializer: Node | undefined): string | undefined {
  return initializer?.asKind(SyntaxKind.StringLiteral)?.getLiteralText()
}

function methodStringsFromInitializer(
  initializer: Node | undefined,
  sourceFile: SourceFile,
): string[] {
  if (!initializer) return []
  const literal = initializer.asKind(SyntaxKind.StringLiteral)
  if (literal) return [literal.getLiteralText().toUpperCase()]

  if (Node.isIdentifier(initializer)) {
    return getStringArray(sourceFile, initializer.getText()).map((method) => method.toUpperCase())
  }

  const array = initializer.asKind(SyntaxKind.ArrayLiteralExpression)
  if (!array) return []

  return array.getElements().flatMap((element) => {
    const elementLiteral = element.asKind(SyntaxKind.StringLiteral)
    if (elementLiteral) return [elementLiteral.getLiteralText().toUpperCase()]
    if (element.getKind() === SyntaxKind.SpreadElement) {
      const identifier = element.getText().slice(3)
      return getStringArray(sourceFile, identifier).map((method) => method.toUpperCase())
    }
    return []
  })
}

function objectLiteralStringKeys(sourceFile: SourceFile, name: string): string[] {
  const initializer = sourceFile.getVariableDeclaration(name)?.getInitializer()
  const object = initializer?.asKind(SyntaxKind.ObjectLiteralExpression)
  if (!object) return []
  return object.getProperties().flatMap((property) => {
    if (!Node.isPropertyAssignment(property)) return []
    const nameNode = property.getNameNode()
    if (Node.isStringLiteral(nameNode)) return [nameNode.getLiteralText()]
    if (Node.isIdentifier(nameNode)) return [nameNode.getText()]
    return []
  })
}

function getFunctionBodyText(sourceFile: SourceFile, name: string): string {
  return sourceFile.getFunction(name)?.getBodyText() ?? ''
}

function sortedValues(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}

function routeRegistrations(files: SourceFile[]): RouteRegistration[] {
  const routes: RouteRegistration[] = []
  for (const file of files) {
    file.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return
      const expression = node.getExpression()
      if (!Node.isPropertyAccessExpression(expression)) return
      const method = expression.getName().toUpperCase()
      const pos = file.getLineAndColumnAtPos(node.getStart())
      if (method === 'ROUTE') {
        const config = node.getArguments()[0]
        if (!config) return
        const route =
          routeStringFromInitializer(propertyInitializer(config, 'url')) ??
          routeStringFromInitializer(propertyInitializer(config, 'path'))
        if (!route) return
        const methods = methodStringsFromInitializer(propertyInitializer(config, 'method'), file)
        for (const configuredMethod of methods) {
          if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(configuredMethod))
            continue
          routes.push({ method: configuredMethod, route, file: rel(file), line: pos.line })
        }
        return
      }

      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return
      const firstArg = node.getArguments()[0]
      const route = firstArg?.asKind(SyntaxKind.StringLiteral)?.getLiteralText()
      if (!route) return
      routes.push({ method, route, file: rel(file), line: pos.line })
    })
  }
  return routes
}

function calledIdentifierNames(node: Node): Set<string> {
  const names = new Set<string>()
  node.forEachDescendant((descendant) => {
    if (!Node.isCallExpression(descendant)) return
    const expression = descendant.getExpression()
    if (Node.isIdentifier(expression)) {
      names.add(expression.getText())
    }
  })
  return names
}

function isRandomUuidCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false
  const expression = node.getExpression()
  if (Node.isIdentifier(expression)) {
    return expression.getText() === 'randomUUID'
  }
  return Node.isPropertyAccessExpression(expression) && expression.getName() === 'randomUUID'
}

function findRandomUuidCall(node: Node): Node | undefined {
  let randomUuidCall: Node | undefined
  node.forEachDescendant((descendant) => {
    if (randomUuidCall || !isRandomUuidCall(descendant)) return
    randomUuidCall = descendant
  })
  return randomUuidCall
}

function localFunctionCanMintRandomUuid(
  fn: FunctionDeclaration,
  localFunctions: ReadonlyMap<string, FunctionDeclaration>,
  seen = new Set<string>(),
): boolean {
  const name = fn.getName()
  if (!name || seen.has(name)) return false
  seen.add(name)

  const body = fn.getBody()
  if (!body) return false
  if (findRandomUuidCall(body)) return true

  for (const calledName of calledIdentifierNames(body)) {
    const calledFunction = localFunctions.get(calledName)
    if (calledFunction && localFunctionCanMintRandomUuid(calledFunction, localFunctions, seen)) {
      return true
    }
  }
  return false
}

function checkCommandRouteLocalIdMinting(check: string, sourceFile: SourceFile): void {
  const localFunctions = new Map<string, FunctionDeclaration>()
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName()
    if (name) localFunctions.set(name, fn)
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return
    const expression = node.getExpression()
    if (!Node.isPropertyAccessExpression(expression)) return
    const method = expression.getName().toUpperCase()
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return
    const route = node.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralText()
    if (!route?.startsWith('/api/v1/commands/')) return

    const handler = node.getArguments()[1]
    if (!handler || (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler))) {
      return
    }

    const directRandomUuidCall = findRandomUuidCall(handler)
    if (directRandomUuidCall) {
      fail(
        check,
        `${method} ${route} must not mint durable command ids with randomUUID() in the route handler.`,
        directRandomUuidCall,
      )
      return
    }

    handler.forEachDescendant((descendant) => {
      if (!Node.isCallExpression(descendant)) return
      const callExpression = descendant.getExpression()
      if (!Node.isIdentifier(callExpression)) return
      const calledFunction = localFunctions.get(callExpression.getText())
      if (!calledFunction || !localFunctionCanMintRandomUuid(calledFunction, localFunctions)) {
        return
      }
      fail(
        check,
        `${method} ${route} must not mint durable command ids through route-local helper ${callExpression.getText()}().`,
        descendant,
      )
    })
  })
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

const MUTATING_ROUTE_RULES: MutatingRouteRule[] = [
  {
    routePrefix: '/api/v1/commands/',
    kind: 'active-writer',
    reason: 'public command routes mutate server-owned JSON state',
    activeWriterNeedles: ["path.startsWith('/api/v1/commands/')"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/import/risusave',
    kind: 'active-writer',
    reason: 'risusave import replaces the repository database',
    activeWriterNeedles: ["path === '/api/v1/import/risusave'"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/assets',
    kind: 'active-writer',
    reason: 'asset upload writes repository asset metadata and blobs',
    activeWriterNeedles: ["path === '/api/v1/assets'"],
  },
  {
    routePrefix: '/api/v1/backups',
    kind: 'active-writer',
    reason: 'backup create, restore, and delete mutate server-owned backup/repository state',
    activeWriterNeedles: ["path.startsWith('/api/v1/backups')"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/generate/chat',
    kind: 'active-writer',
    reason: 'chat generation can create memory chunks and enqueue memory jobs',
    activeWriterNeedles: ["path === '/api/v1/generate/chat'"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/generate/preview-prompt',
    kind: 'active-writer',
    reason: 'prompt preview can run generation-time memory planning',
    activeWriterNeedles: ["path === '/api/v1/generate/preview-prompt'"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/memory/jobs',
    kind: 'active-writer',
    reason: 'memory job creation writes durable SQLite job state',
    activeWriterNeedles: ["path === '/api/v1/memory/jobs'"],
  },
  {
    methods: ['DELETE'],
    route: '/api/v1/memory/jobs/:id',
    kind: 'active-writer',
    reason: 'memory job cancellation writes durable SQLite job state',
    activeWriterNeedles: ["method === 'DELETE'", "path.startsWith('/api/v1/memory/jobs/')"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/storage/write',
    kind: 'active-writer',
    reason: 'legacy storage write mutates server-owned compatibility files',
    activeWriterNeedles: ["path === '/api/v1/storage/write'"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/storage/remove',
    kind: 'active-writer',
    reason: 'legacy storage remove mutates server-owned compatibility files',
    activeWriterNeedles: ["path === '/api/v1/storage/remove'"],
  },
  {
    methods: ['POST'],
    route: '/api/v1/auth/setup',
    kind: 'auth-session',
    reason: 'auth bootstrap writes password state before a browser writer session exists',
  },
  {
    methods: ['POST'],
    route: '/api/v1/auth/login',
    kind: 'auth-session',
    reason: 'login records trusted public keys as auth metadata, not Risu JSON/SQLite state',
  },
  {
    methods: ['POST'],
    route: '/api/v1/auth/crypto',
    kind: 'stateless-helper',
    reason: 'crypto helper returns a hash and does not persist state',
  },
  {
    methods: ['POST'],
    route: '/api/v1/assets/exists',
    kind: 'read-only-post',
    reason: 'asset existence probe reads repository state despite using POST for request size',
  },
  {
    methods: ['POST'],
    route: '/api/v1/generate/completion',
    kind: 'runtime-generation',
    reason: 'provider completion is a runtime request and does not write local durable state',
  },
  {
    methods: ['POST'],
    route: '/api/v1/proxy/fetch',
    kind: 'runtime-proxy',
    reason: 'generic fetch proxy forwards an upstream request without local durable writes',
  },
  {
    methods: ['POST'],
    route: '/api/v1/proxy/stream-jobs',
    kind: 'runtime-proxy',
    reason: 'stream job creation stores only in-memory proxy job state',
  },
  {
    methods: ['DELETE'],
    route: '/api/v1/proxy/stream-jobs/:id',
    kind: 'runtime-proxy',
    reason: 'stream job cancellation deletes only in-memory proxy job state',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    routePrefix: '/api/v1/hub/',
    kind: 'runtime-proxy',
    reason: 'hub routes forward to the configured hub service instead of mutating local state',
  },
]

function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method)
}

function routeRuleMatches(rule: MutatingRouteRule, route: RouteRegistration): boolean {
  if (rule.methods && !rule.methods.includes(route.method)) return false
  if (rule.route && rule.route === route.route) return true
  if (rule.routePrefix && route.route.startsWith(rule.routePrefix)) return true
  return false
}

function classifyMutatingRoute(route: RouteRegistration): MutatingRouteRule | undefined {
  return MUTATING_ROUTE_RULES.find((rule) => routeRuleMatches(rule, route))
}

function routeKey(route: Pick<RouteRegistration, 'method' | 'route'>): string {
  return `${route.method} ${route.route}`
}

function assertMutatingRouteRulesAreLive(
  check: string,
  mutatingRoutes: readonly RouteRegistration[],
): void {
  for (const rule of MUTATING_ROUTE_RULES) {
    const matchingRoutes = mutatingRoutes.filter((route) => routeRuleMatches(rule, route))
    if (matchingRoutes.length === 0) {
      const target = rule.route ?? `${rule.routePrefix}*`
      const methods = rule.methods?.join('/') ?? 'POST/PATCH/PUT/DELETE'
      fail(check, `mutating route classification is stale: no discovered ${methods} ${target}.`)
    }
  }
}

function checkActiveWriterGuard(): void {
  const check = 'EC5 active-writer guard'
  const appText = text('server/fastify/src/app.ts')
  const bootstrapIndex = appText.indexOf('registerBootstrapRoutes(')
  const guardIndex = appText.indexOf('registerActiveWriterGuard(app, activeWriterState)')
  const mutationRegistrarIndexes = [
    'registerSaveRoutes(',
    'registerCommandRoutes(',
    'registerAssetsRoutes(',
    'registerBackupRoutes(',
    'registerLegacyStorageRoutes(',
    'registerGenerationChatRoutes(',
    'registerMemoryJobRoutes(',
  ]
    .map((needle) => appText.indexOf(needle))
    .filter((index) => index >= 0)
  const firstMutationIndex =
    mutationRegistrarIndexes.length > 0 ? Math.min(...mutationRegistrarIndexes) : -1
  if (guardIndex === -1) {
    fail(
      check,
      'registerActiveWriterGuard is not wired in buildApp.',
      undefined,
      'server/fastify/src/app.ts',
    )
  } else {
    if (bootstrapIndex === -1 || guardIndex < bootstrapIndex) {
      fail(
        check,
        'active-writer guard must be registered after bootstrap can register the latest writer session.',
        undefined,
        'server/fastify/src/app.ts',
      )
    }
    if (firstMutationIndex === -1 || guardIndex > firstMutationIndex) {
      fail(
        check,
        'active-writer guard must be registered before server-owned mutation routes.',
        undefined,
        'server/fastify/src/app.ts',
      )
    }
  }

  const activeWriterText = text('server/fastify/src/activeWriter.ts')

  const routeFiles = project
    .getSourceFiles()
    .filter((file) => rel(file).startsWith('server/fastify/src/routes/'))
  const mutatingRoutes = routeRegistrations(routeFiles).filter((route) =>
    isMutatingMethod(route.method),
  )
  if (mutatingRoutes.length === 0) {
    fail(check, 'No mutating Fastify routes were discovered; audit route extraction is stale.')
  }

  assertMutatingRouteRulesAreLive(check, mutatingRoutes)

  for (const route of mutatingRoutes) {
    const classification = classifyMutatingRoute(route)
    if (!classification) {
      fail(
        check,
        `Unclassified mutating Fastify route: ${routeKey(route)}. Add a guarded or explicit exemption classification.`,
        undefined,
        path.join(root, route.file),
      )
      continue
    }

    if (classification.kind !== 'active-writer') continue
    for (const needle of classification.activeWriterNeedles ?? []) {
      if (!activeWriterText.includes(needle)) {
        fail(
          check,
          `active-writer classifier does not cover ${routeKey(route)} (${classification.reason}); missing ${needle}.`,
          undefined,
          'server/fastify/src/activeWriter.ts',
        )
      }
    }
  }

  const serverMemoryText = text('src/ts/process/request/serverMemory.ts')
  for (const needle of [
    'activeWriterSessionHeader',
    'handleActiveWriterStaleResponse',
    '{ activeWriter: true }',
  ]) {
    if (!serverMemoryText.includes(needle)) {
      fail(
        check,
        `server memory client helper is missing active-writer handling: ${needle}.`,
        undefined,
        'src/ts/process/request/serverMemory.ts',
      )
    }
  }

  const serverChatText = text('src/ts/process/request/serverChat.ts')
  for (const needle of ['activeWriterSessionHeader', 'handleActiveWriterStaleResponse']) {
    if (!serverChatText.includes(needle)) {
      fail(
        check,
        `server chat client helper is missing active-writer handling: ${needle}.`,
        undefined,
        'src/ts/process/request/serverChat.ts',
      )
    }
  }
}

function checkStableIdCommandPaths(): void {
  const check = 'EC4 stable command ids'
  const prompts = source('server/fastify/src/commands/prompts.ts')
  const messages = source('server/fastify/src/commands/messages.ts')
  const lorebooks = source('server/fastify/src/commands/lorebooks.ts')
  const scripts = source('server/fastify/src/commands/scriptDefinitions.ts')
  const characters = source('server/fastify/src/commands/characters.ts')
  const presets = source('server/fastify/src/commands/presets.ts')
  const personas = source('server/fastify/src/commands/personas.ts')
  const translatorPresets = source('server/fastify/src/commands/translatorPresets.ts')
  const loadouts = source('server/fastify/src/commands/loadouts.ts')
  const modules = source('server/fastify/src/commands/modules.ts')
  const chats = source('server/fastify/src/commands/chats.ts')

  const noMintFunctions = new Map<SourceFile, string[]>([
    [characters, ['createCharacterRecord']],
    [presets, ['createPresetRecord']],
    [personas, ['createPersonaRecord']],
    [translatorPresets, ['createTranslatorPresetRecord']],
    [loadouts, ['createLoadoutRecord']],
    [modules, ['createModuleRecord']],
    [chats, ['createChatRecord', 'createChatFolderRecord']],
    [prompts, ['createPromptItemRecord']],
    [messages, ['createMessageRecord', 'readReplacementMessages', 'readGenerationResult']],
    [lorebooks, ['createGlobalLorebookRecord', 'readLorebookEntries']],
    [scripts, ['readScriptDefinitions', 'readTriggerDefinitions']],
  ])

  for (const [file, functionNames] of noMintFunctions) {
    for (const functionName of functionNames) {
      const body = getFunctionBodyText(file, functionName)
      if (!body) {
        fail(check, `Missing expected command-path validator ${functionName}.`, undefined, file)
        continue
      }
      if (body.includes('randomUUID(')) {
        fail(
          check,
          `${functionName} must reject missing/duplicate stable ids instead of minting them.`,
          file.getFunction(functionName),
        )
      }
    }
  }

  const serverCommands = source('server/fastify/src/routes/commands.ts')
  checkCommandRouteLocalIdMinting(check, serverCommands)

  const clientCommands = source('src/ts/server/commands.ts')
  const promptSettingKeys = getStringArray(prompts, 'PROMPT_SETTINGS_KEYS')
  const serverSettingsKeys = text('server/fastify/src/routes/commands.ts')
  const clientSettingsKeys = objectLiteralStringKeys(clientCommands, 'SERVER_SETTINGS_GROUP_BY_KEY')
  for (const key of ['promptTemplate']) {
    if (promptSettingKeys.includes(key)) {
      fail(
        check,
        `${key} must not be writable through /commands/prompt-settings.`,
        prompts.getVariableDeclaration('PROMPT_SETTINGS_KEYS'),
      )
    }
    if (serverSettingsKeys.includes(`'${key}'`) || serverSettingsKeys.includes(`"${key}"`)) {
      fail(check, `${key} must not be writable through generic settings commands.`, serverCommands)
    }
    if (clientSettingsKeys.includes(key)) {
      fail(
        check,
        `${key} must not be routed through the client generic settings map.`,
        clientCommands.getVariableDeclaration('SERVER_SETTINGS_GROUP_BY_KEY'),
      )
    }
  }
}

function checkPluginStorageGates(): void {
  const check = 'EC2 plugin storage gates'
  const safeClass = source('src/ts/plugins/pluginSafeClass.ts')
  const safeText = safeClass.getFullText()
  assertCheck(
    check,
    safeText.includes('DBState.db.pluginCompatibilityMode === true'),
    'device-local plugin storage must be gated by pluginCompatibilityMode in Fastify mode.',
    safeClass,
  )

  const guardedMethods = ['getItem', 'setItem', 'removeItem', 'keys', 'key', 'clear']
  for (const className of ['SafeLocalStorage', 'SafeLocalPluginStorage']) {
    const klass = safeClass.getClass(className)
    if (!klass) {
      fail(check, `Missing ${className}.`, undefined, safeClass)
      continue
    }
    for (const methodName of guardedMethods) {
      const method = klass.getMethod(methodName) ?? klass.getGetAccessor(methodName)
      if (!method) continue
      if (!method.getText().includes('assertDeviceLocalPluginStorageEnabled()')) {
        fail(
          check,
          `${className}.${methodName} must assert Plugin Compatibility Mode before touching device-local storage.`,
          method,
        )
      }
    }
  }

  const safeIdb = safeClass
    .getVariableDeclaration('SafeIdbFactory')
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression)
  if (!safeIdb) {
    fail(check, 'Missing SafeIdbFactory.', undefined, safeClass)
  } else {
    for (const property of safeIdb.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue
      if (!property.getText().includes('assertDeviceLocalPluginStorageEnabled()')) {
        fail(
          check,
          `SafeIdbFactory.${property.getName()} must assert Plugin Compatibility Mode before touching IndexedDB.`,
          property,
        )
      }
    }
  }

  const plugins = source('src/ts/plugins/plugins.svelte.ts')
  const allowedDbKeys = getStringArray(plugins, 'allowedDbKeys')
  const unsupportedKeys = getStringArray(plugins, 'unsupportedServerBridgeKeys')
  if (allowedDbKeys.includes('pluginV2') && !unsupportedKeys.includes('pluginV2')) {
    fail(
      check,
      'pluginV2 is exposed in allowedDbKeys but is not blocked by unsupportedServerBridgeKeys.',
      plugins.getVariableDeclaration('unsupportedServerBridgeKeys'),
    )
  }

  const v3 = source('src/ts/plugins/apiV3/v3.svelte.ts')
  const v3Text = v3.getFullText()
  for (const needle of [
    "saveMethod: isFastifyServer ? 'server' : 'local'",
    'deviceLocalPluginStorage: isDeviceLocalPluginStorageEnabled()',
    'getLocalPluginStorage: () =>',
    'assertDeviceLocalPluginStorageEnabled()',
  ]) {
    if (!v3Text.includes(needle)) {
      fail(check, `Plugin V3 runtime/storage bridge is missing ${needle}.`, undefined, v3)
    }
  }
}

const ASSET_WALKER_COLLECTORS = new Set([
  'addReference',
  'addTupleReferences',
  'addCcAssetReferences',
  'addVitsReferences',
  'addReferenceList',
  'addGptSoVitsReference',
])

const ASSET_WALKER_OWNERS: AssetWalkerOwner[] = [
  {
    collector: 'addReference',
    value: 'root.userIcon',
    path: 'database.userIcon',
    owner: 'legacy profile mirror from selected persona icon',
    validatorFile: 'server/fastify/src/commands/personas.ts',
    validatorNeedles: [
      'validateOptionalServerAssetRef(options.assetDataDir, record.icon',
      'database.userIcon = stringValue(persona.icon)',
    ],
  },
  {
    collector: 'addReference',
    value: 'root.customBackground',
    path: 'database.customBackground',
    owner: 'display settings command validator',
    validatorFile: 'server/fastify/src/routes/commands.ts',
    validatorNeedles: [
      'validateSettingsAssetRefs(dataDir, patch)',
      "'customBackground' in patch",
      "validateOptionalServerAssetRef(dataDir, patch.customBackground, 'customBackground')",
    ],
  },
  {
    collector: 'addReference',
    value: 'record.icon',
    path: 'database.personas[*].icon',
    owner: 'persona create/patch validators',
    validatorFile: 'server/fastify/src/commands/personas.ts',
    validatorNeedles: [
      "'icon' in record",
      'validateOptionalServerAssetRef(options.assetDataDir, record.icon',
    ],
  },
  {
    collector: 'addReference',
    value: 'record.img',
    path: 'database.characterOrder[*].img',
    owner: 'character order reorder validator',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: [
      'validateCharacterOrderLegacyImageRef(dataDir, entry.img',
      'validateOptionalServerAssetRef(dataDir, value, label)',
    ],
  },
  {
    collector: 'addReference',
    value: 'record.imgFile',
    path: 'database.characterOrder[*].imgFile',
    owner: 'character order reorder validator',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: [
      'validateOptionalServerAssetRef(dataDir, entry.imgFile',
      'validateCharacterOrderAssetRefs',
    ],
  },
  {
    collector: 'addReference',
    value: 'record.image',
    path: 'database.botPresets[*].image',
    owner: 'preset create/patch validators',
    validatorFile: 'server/fastify/src/commands/presets.ts',
    validatorNeedles: [
      "'image' in record",
      'validateOptionalServerAssetRef(options.assetDataDir, record.image',
    ],
  },
  {
    collector: 'addTupleReferences',
    value: 'record.assets',
    path: 'database.modules[*].assets[*][1]',
    owner: 'module create/patch validators',
    validatorFile: 'server/fastify/src/commands/modules.ts',
    validatorNeedles: ["'assets' in record", 'validateAssetTriples(assetOptions.assetDataDir'],
  },
  {
    collector: 'addReference',
    value: 'record.image',
    path: 'database.characters[*].image',
    owner: 'character create/patch validators',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: ["'image' in record", 'validateOptionalServerAssetRef(dataDir, record.image'],
  },
  {
    collector: 'addTupleReferences',
    value: 'record.emotionImages',
    path: 'database.characters[*].emotionImages[*][1]',
    owner: 'character create/patch validators',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: ["'emotionImages' in record", 'validateEmotionImageRefs(dataDir'],
  },
  {
    collector: 'addTupleReferences',
    value: 'record.additionalAssets',
    path: 'database.characters[*].additionalAssets[*][1]',
    owner: 'character create/patch validators',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: ["'additionalAssets' in record", 'validateAssetTriples(dataDir'],
  },
  {
    collector: 'addCcAssetReferences',
    value: 'record.ccAssets',
    path: 'database.characters[*].ccAssets[*].uri',
    owner: 'character create/patch validators',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: ["'ccAssets' in record", 'validateCcAssetRefs(dataDir'],
  },
  {
    collector: 'addVitsReferences',
    value: 'record.vits',
    path: 'database.characters[*].vits.files.*',
    owner: 'character create/patch validators',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: ["'vits' in record", 'validateVitsAssetRefs(dataDir'],
  },
  {
    collector: 'addReferenceList',
    value: 'record.prebuiltAssetExclude',
    path: 'database.characters[*].prebuiltAssetExclude[*]',
    owner: 'character create/patch validators',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: ["'prebuiltAssetExclude' in record", 'validateAssetIdList(dataDir'],
  },
  {
    collector: 'addGptSoVitsReference',
    value: 'record.gptSoVitsConfig',
    path: 'database.characters[*].gptSoVitsConfig.ref_audio_data.assetId',
    owner: 'character create/patch validators',
    validatorFile: 'server/fastify/src/commands/characters.ts',
    validatorNeedles: ["'gptSoVitsConfig' in record", 'validateGptSoVitsAssetRefs(dataDir'],
  },
]

function normalizeAssetWalkerLabel(labelExpression: Node | undefined): string | undefined {
  if (!labelExpression) return undefined
  const literal = labelExpression.asKind(SyntaxKind.StringLiteral)
  if (literal) return literal.getLiteralText()

  const raw = labelExpression.getText()
  const withoutTicks = raw.startsWith('`') && raw.endsWith('`') ? raw.slice(1, -1) : raw
  return withoutTicks.replaceAll('${index}', '*').replaceAll('${prefix}', 'database.characters[*]')
}

function expandAssetWalkerPath(collector: string, label: string): string {
  switch (collector) {
    case 'addTupleReferences':
      return `${label}[*][1]`
    case 'addCcAssetReferences':
      return `${label}[*].uri`
    case 'addVitsReferences':
      return `${label}.*`
    case 'addReferenceList':
      return `${label}[*]`
    case 'addGptSoVitsReference':
      return `${label}.ref_audio_data.assetId`
    default:
      return label
  }
}

function assetWalkerFieldKey(field: AssetWalkerField): string {
  return `${field.collector} ${field.value} -> ${field.path}`
}

function collectAssetWalkerFields(sourceFile: SourceFile): AssetWalkerField[] {
  const collectFunction = sourceFile.getFunction('collectRisuSaveAssetReferences')
  const fields: AssetWalkerField[] = []
  collectFunction?.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return
    const expression = node.getExpression()
    if (!Node.isIdentifier(expression)) return
    const collector = expression.getText()
    if (!ASSET_WALKER_COLLECTORS.has(collector)) return
    const args = node.getArguments()
    const value = args[1]?.getText()
    const label = normalizeAssetWalkerLabel(args[2])
    if (!value || !label) return
    fields.push({ collector, value, path: expandAssetWalkerPath(collector, label) })
  })
  return fields
}

function checkAssetWalkerValidators(): void {
  const check = 'EC6 asset walker validator drift'
  const walker = source('server/fastify/src/risuSave/assetReferences.ts')
  const collected = collectAssetWalkerFields(walker)
  if (collected.length === 0) {
    fail(
      check,
      'No asset walker fields were discovered; audit collector extraction is stale.',
      walker,
    )
    return
  }

  const collectedKeys = sortedValues(collected.map(assetWalkerFieldKey))
  const ownerKeys = sortedValues(ASSET_WALKER_OWNERS.map(assetWalkerFieldKey))
  const collectedSet = new Set(collectedKeys)
  const ownerSet = new Set(ownerKeys)
  const missingOwners = collectedKeys.filter((key) => !ownerSet.has(key))
  const staleOwners = ownerKeys.filter((key) => !collectedSet.has(key))

  if (missingOwners.length > 0) {
    fail(
      check,
      `Asset walker fields lack validator ownership: ${missingOwners.join('; ')}.`,
      undefined,
      walker,
    )
  }
  if (staleOwners.length > 0) {
    fail(
      check,
      `Asset walker validator ownership table is stale: ${staleOwners.join('; ')}.`,
      undefined,
      walker,
    )
  }

  for (const owner of ASSET_WALKER_OWNERS) {
    const validatorText = text(owner.validatorFile)
    for (const needle of owner.validatorNeedles) {
      if (!validatorText.includes(needle)) {
        fail(
          check,
          `Asset walker path ${owner.path} is owned by ${owner.owner}, but ${owner.validatorFile} is missing ${needle}.`,
          undefined,
          owner.validatorFile,
        )
      }
    }
  }
}

function checkRisuSaveImportExportShape(): void {
  const check = 'AEC2 import/export current shape'
  const importer = source('server/fastify/src/risuSave/importSnapshot.ts')
  const exporter = source('server/fastify/src/risuSave/exportSnapshot.ts')
  const exporterText = text('server/fastify/src/risuSave/exportSnapshot.ts')
  const normalizeBody = getFunctionBodyText(importer, 'normalizeImportDatabase')
  const assembleBody = getFunctionBodyText(importer, 'assembleBlockDatabase')

  const requiredExportNeedles = [
    'database.characters',
    'database.botPresets',
    'database.modules',
    'database.loadouts',
    'database.plugins',
    'database.pluginCustomStorage',
  ]
  for (const needle of requiredExportNeedles) {
    if (!exporterText.includes(needle)) {
      fail(
        check,
        `Block export no longer requires ${needle}; update the AEC2 audit shape contract.`,
        undefined,
        'server/fastify/src/risuSave/exportSnapshot.ts',
      )
    }
  }

  const requiredImportNeedles = [
    'normalizeCharacterCollection(target)',
    'normalizePresetCollection(target)',
    'ensureModuleRecords(target)',
    'normalizeLoadoutCollection(target)',
    'ensurePluginRecords(target)',
    'ensurePluginCustomStorage(target)',
  ]
  for (const needle of requiredImportNeedles) {
    if (!normalizeBody.includes(needle)) {
      fail(
        check,
        `normalizeImportDatabase must call ${needle} so accepted imports stay block-exportable.`,
        importer.getFunction('normalizeImportDatabase'),
      )
    }
  }

  const exportResourceKeys = sortedValues(getStringArray(exporter, 'BLOCK_RESOURCE_KEYS'))
  const rootComponentReservedKeys = sortedValues(
    getStringArray(importer, 'ROOT_COMPONENT_RESERVED_KEYS'),
  )
  if (exportResourceKeys.join('\0') !== rootComponentReservedKeys.join('\0')) {
    fail(
      check,
      `ROOT_COMPONENT reserved keys must match block export resource keys. export=${exportResourceKeys.join(',')} import=${rootComponentReservedKeys.join(',')}`,
      importer.getVariableDeclaration('ROOT_COMPONENT_RESERVED_KEYS'),
    )
  }

  if (
    !assembleBody.includes('ROOT_COMPONENT_RESERVED_KEYS.has(component.key)') ||
    !assembleBody.includes('reserved for resource blocks')
  ) {
    fail(
      check,
      'ROOT_COMPONENT import must reject reserved resource-family keys before assigning database[component.key].',
      importer.getFunction('assembleBlockDatabase'),
    )
  }
}

function checkChatFolderIdentityScope(): void {
  const check = 'AEC4 chat folder identity scope'
  const chats = source('server/fastify/src/commands/chats.ts')
  const routesText = text('server/fastify/src/routes/commands.ts')
  const normalizeBody = getFunctionBodyText(chats, 'normalizeAllCharacterChats')
  const repairBody = getFunctionBodyText(chats, 'normalizeGlobalChatFolderIds')

  if (!normalizeBody.includes('normalizeGlobalChatFolderIds(characters)')) {
    fail(
      check,
      'normalizeAllCharacterChats must repair chat folder ids globally across characters.',
      chats.getFunction('normalizeAllCharacterChats'),
    )
  }

  for (const needle of ['seen.has(folder.id)', 'folder.id = randomUUID()', 'chat.folderId =']) {
    if (!repairBody.includes(needle)) {
      fail(
        check,
        `normalizeGlobalChatFolderIds must preserve global folder-id uniqueness and update chat refs; missing ${needle}.`,
        chats.getFunction('normalizeGlobalChatFolderIds'),
      )
    }
  }

  const globalCreateGuards = routesText.match(/chatFolderIdExists\(characters, folder\.id\)/g) ?? []
  if (globalCreateGuards.length < 2) {
    fail(
      check,
      'Chat folder create command surfaces must reject ids already used by any character.',
      undefined,
      'server/fastify/src/routes/commands.ts',
    )
  }
}

function checkModuleReferenceSemantics(): void {
  const check = 'AEC5 module reference semantics'
  const modules = source('server/fastify/src/commands/modules.ts')
  const routesText = text('server/fastify/src/routes/commands.ts')
  const validateBody = getFunctionBodyText(modules, 'validateNormalModuleLinks')

  if (!validateBody.includes('!module.mcp')) {
    fail(
      check,
      'Normal module-link validation must exclude MCP module rows from linkable command ids.',
      modules.getFunction('validateNormalModuleLinks'),
    )
  }

  if (!validateBody.includes('Unknown module id in ${label}')) {
    fail(
      check,
      'Normal module-link validation must reject unresolved module ids instead of tolerating them.',
      modules.getFunction('validateNormalModuleLinks'),
    )
  }

  const normalLinkChecks = routesText.match(/validateNormalModuleLinks\(/g) ?? []
  if (normalLinkChecks.length < 4) {
    fail(
      check,
      'Chat create, patch, fork sourcePatch, and forked-chat writes must all validate normal module links.',
      undefined,
      'server/fastify/src/routes/commands.ts',
    )
  }

  for (const needle of [
    "'chat.modules'",
    "'patch.modules'",
    "'sourcePatch.modules'",
    'validateCharacterModuleLinks(modules, moduleIds)',
  ]) {
    if (!routesText.includes(needle)) {
      fail(
        check,
        `Command route module-link validation is missing ${needle}.`,
        undefined,
        'server/fastify/src/routes/commands.ts',
      )
    }
  }
}

function checkAssetPersistenceSemantics(): void {
  const check = 'AEC6 asset persistence semantics'
  const repository = source('server/fastify/src/repository.ts')
  const assetCommands = source('server/fastify/src/commands/assets.ts')
  const characters = source('server/fastify/src/commands/characters.ts')
  const addAssetBody = getFunctionBodyText(repository, 'addAsset')
  const optionalRefBody = getFunctionBodyText(assetCommands, 'validateOptionalServerAssetRef')
  const characterText = text('server/fastify/src/commands/characters.ts')

  for (const needle of [
    'const file = assetPath(dataDir, existing)',
    'if (!fs.existsSync(file))',
    'fs.writeFileSync(file, args.bytes)',
  ]) {
    if (!addAssetBody.includes(needle)) {
      fail(
        check,
        `addAsset must heal missing blobs for existing asset metadata; missing ${needle}.`,
        repository.getFunction('addAsset'),
      )
    }
  }

  for (const clearValue of ["''", "'-'"]) {
    if (!assetCommands.getFullText().includes(clearValue)) {
      fail(
        check,
        `Optional server asset refs must preserve ${clearValue} as an accepted clear value.`,
        assetCommands.getVariableDeclaration('CLEARABLE_ASSET_VALUES'),
      )
    }
  }
  if (!optionalRefBody.includes('value === null')) {
    fail(
      check,
      'Optional server asset refs must preserve null as an accepted clear value.',
      assetCommands.getFunction('validateOptionalServerAssetRef'),
    )
  }

  for (const needle of [
    'validateVitsAssetRefs(dataDir, record.vits',
    'validateGptSoVitsAssetRefs(dataDir, record.gptSoVitsConfig',
  ]) {
    if (!characterText.includes(needle)) {
      fail(
        check,
        `Character command validation must cover optional audio asset refs; missing ${needle}.`,
        characters,
      )
    }
  }
}

function checkProviderOwnership(): void {
  const check = 'EC1 provider ownership'
  const serverCompletion = source('src/ts/process/request/serverCompletion.ts')
  const serverCompletionText = serverCompletion.getFullText()
  for (const needle of [
    "if (!isFastifyServer) return { type: 'local' }",
    'Provider preview bodies are not supported in Fastify server mode',
    'is not supported in Fastify server mode',
  ]) {
    if (!serverCompletionText.includes(needle)) {
      fail(
        check,
        `serverCompletion route resolution is missing the Fastify server-mode guard: ${needle}`,
        undefined,
        serverCompletion,
      )
    }
  }

  const google = source('src/ts/process/request/google.ts')
  const googleText = google.getFullText()
  if (
    !googleText.includes('if (!isFastifyServer)') ||
    !googleText.includes('withTrustedServerProjectionWrite')
  ) {
    fail(
      check,
      'Browser Vertex token projection writes must be unreachable in Fastify mode.',
      undefined,
      google,
    )
  }

  const clientCommands = source('src/ts/server/commands.ts')
  const settingsKeys = objectLiteralStringKeys(clientCommands, 'SERVER_SETTINGS_GROUP_BY_KEY')
  if (settingsKeys.includes('useServerGeneration')) {
    fail(
      check,
      'useServerGeneration must not be exposed as a Fastify server settings command.',
      clientCommands.getVariableDeclaration('SERVER_SETTINGS_GROUP_BY_KEY'),
    )
  }
}

function runChecks(checks: AuditCheck[]): void {
  for (const check of checks) {
    try {
      check.run()
    } catch (err) {
      findings.push({
        check: check.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

runChecks([
  { id: 'EC5 active-writer guard', run: checkActiveWriterGuard },
  { id: 'EC4 stable command ids', run: checkStableIdCommandPaths },
  { id: 'EC2 plugin storage gates', run: checkPluginStorageGates },
  { id: 'EC6 asset walker validator drift', run: checkAssetWalkerValidators },
  { id: 'AEC2 import/export current shape', run: checkRisuSaveImportExportShape },
  { id: 'AEC4 chat folder identity scope', run: checkChatFolderIdentityScope },
  { id: 'AEC5 module reference semantics', run: checkModuleReferenceSemantics },
  { id: 'AEC6 asset persistence semantics', run: checkAssetPersistenceSemantics },
  { id: 'EC1 provider ownership', run: checkProviderOwnership },
])

if (findings.length > 0) {
  console.error('Client-thinning audit failed:')
  for (const finding of findings) {
    const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : ''
    console.error(`- [${finding.check}] ${finding.message}${location ? ` (${location})` : ''}`)
  }
  process.exitCode = 1
} else {
  console.log('Client-thinning audit passed.')
}
