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
  'server/fastify/src/auth.ts',
  'server/fastify/src/db.ts',
  'server/fastify/src/repository.ts',
  'server/fastify/src/providerSecrets.ts',
  'server/fastify/src/routes/**/*.ts',
  'server/fastify/src/commands/**/*.ts',
  'server/fastify/src/risuSave/assetReferences.ts',
  'server/fastify/src/risuSave/exportSnapshot.ts',
  'server/fastify/src/risuSave/importSnapshot.ts',
  'src/ts/bootstrap.ts',
  'src/ts/chatCommands.ts',
  'src/ts/characterCommands.ts',
  'src/ts/moduleCommands.ts',
  'src/ts/characterCards.ts',
  'src/ts/setting/utils.ts',
  'src/ts/server/assets.ts',
  'src/ts/server/bootstrap.ts',
  'src/ts/server/commands.ts',
  'src/ts/server/lorebookBridge.svelte.ts',
  'src/ts/server/scriptDefinitionBridge.svelte.ts',
  'src/ts/plugins/pluginSafeClass.ts',
  'src/ts/plugins/plugins.svelte.ts',
  'src/ts/plugins/apiV3/v3.svelte.ts',
  'src/ts/process/request/serverCompletion.ts',
  'src/ts/process/request/serverChat.ts',
  'src/ts/process/request/serverMemory.ts',
  'src/ts/process/request/request.ts',
  'src/ts/process/request/google.ts',
  'src/ts/process/sendChatContext.ts',
  'src/ts/process/triggers.ts',
  'src/ts/process/modules.ts',
  'src/ts/process/processzip.ts',
  'src/ts/process/transformers.ts',
  'src/ts/process/mcp/risuaccess/modules.ts',
  'src/ts/server/projectionWriteGuard.svelte.ts',
  'src/ts/globalApi.svelte.ts',
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
    // A4EC3 / B2: command-path validators are the no-mint constructors.
    // `validateGlobalLorebookCreate` and `validateLorebookEntries` replaced
    // the repair-permissive `createGlobalLorebookRecord` and
    // `readLorebookEntries` shims at the public routes.
    [lorebooks, ['validateGlobalLorebookCreate', 'validateLorebookEntries']],
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

// Alpha 4 rule rewrites: every rule below derives its surface from
// authoritative source structures (function exports, call graphs, AST literals)
// rather than literal pre-fix substrings or hardcoded allow-lists. The
// invariant the rule enforces is stated in a comment above each function.

// ----- A4R1: Passive refresh must not register writer ownership -----
//
// Invariant: any function in `src/ts/` that issues bootstrap fetches as a
// passive read (event-driven, polling, retry) must not call the
// writer-registering bootstrap helper. The writer-mode helper is identified
// structurally as the bootstrap fetcher whose body attaches the
// `activeWriterSessionHeader()`. Only files in `WRITER_BOOTSTRAP_CALLERS` may
// invoke it.

const WRITER_BOOTSTRAP_CALLERS = new Set<string>([
  // Page-load bootstrap (user-intent writer registration). Update if you add a
  // new writer-intent entrypoint and document why.
  'src/ts/bootstrap.ts',
])

function findWriterModeBootstrapHelpers(): Set<string> {
  // Writer-mode helpers in src/ts/server/bootstrap.ts are exported functions
  // whose body either directly attaches `activeWriterSessionHeader()` OR
  // delegates through a private helper with `registerActiveWriter: true`.
  const helpers = new Set<string>()
  const serverBootstrap = source('src/ts/server/bootstrap.ts')
  for (const fn of serverBootstrap.getFunctions()) {
    if (!fn.isExported()) continue
    const body = fn.getBody()
    if (!body) continue
    const bodyText = body.getText()
    if (
      bodyText.includes('activeWriterSessionHeader()') ||
      bodyText.includes('registerActiveWriter: true')
    ) {
      const name = fn.getName()
      if (name) helpers.add(name)
    }
  }
  return helpers
}

function checkAlpha4PassiveRefresh(): void {
  const check = 'A4R1 passive refresh writer ownership'
  const writerHelpers = findWriterModeBootstrapHelpers()
  if (writerHelpers.size === 0) {
    fail(
      check,
      'No writer-mode bootstrap helpers were discovered; audit derivation is stale.',
      undefined,
      'src/ts/server/bootstrap.ts',
    )
    return
  }

  // Read-only helpers (the projection-refresh counterpart) must not register
  // writer ownership. Every exported bootstrap helper not in the writer list
  // must NOT contain `activeWriterSessionHeader(`.
  const serverBootstrap = source('src/ts/server/bootstrap.ts')
  for (const fn of serverBootstrap.getFunctions()) {
    if (!fn.isExported()) continue
    const name = fn.getName()
    if (!name || writerHelpers.has(name)) continue
    const body = fn.getBody()
    if (!body) continue
    if (body.getText().includes('activeWriterSessionHeader(')) {
      fail(
        check,
        `${name} is a non-writer bootstrap helper but still attaches activeWriterSessionHeader(). Read-only paths must not register writer ownership.`,
        fn,
      )
    }
  }

  // Project-wide: any caller of a writer-mode helper that is not in the
  // allowlist is a passive-refresh that steals ownership.
  for (const writerName of writerHelpers) {
    const fn = serverBootstrap.getFunction(writerName)
    if (!fn) continue
    for (const reference of fn.findReferencesAsNodes()) {
      const file = rel(reference.getSourceFile())
      if (file === 'src/ts/server/bootstrap.ts') continue
      if (file.endsWith('.test.ts')) continue
      if (WRITER_BOOTSTRAP_CALLERS.has(file)) continue
      const parent = reference.getParent()
      // Skip imports/exports/type references; only call expressions register.
      if (!parent || (!Node.isCallExpression(parent) && !Node.isPropertyAccessExpression(parent))) {
        continue
      }
      fail(
        check,
        `${file} calls writer-mode bootstrap helper ${writerName}; add it to WRITER_BOOTSTRAP_CALLERS with explicit rationale or switch to a read-only helper.`,
        reference,
      )
    }
  }
}

// ----- A4R2: Conflict replay forbidden outside the central wrapper -----
//
// Invariant: only `runServerCommand` in `src/ts/server/commands.ts` is allowed
// to branch on a command result whose `status === 'conflict'`. Any other
// function that observes that branch and then re-runs a mutating command is a
// blind replay.

const ALLOWED_CONFLICT_HANDLERS = new Set<string>([
  // The central command wrapper IS the conflict surface; it is allowed to
  // observe and propagate.
  'runServerCommand',
])

function isAllowedConflictFunction(file: string, name: string): boolean {
  if (file === 'src/ts/server/commands.ts' && ALLOWED_CONFLICT_HANDLERS.has(name)) return true
  return false
}

function checkAlpha4ConflictRetry(): void {
  const check = 'A4R2 conflict replay outside central wrapper'
  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('src/')) continue
    if (rl.endsWith('.test.ts')) continue
    for (const fn of file.getFunctions()) {
      const name = fn.getName()
      if (!name) continue
      if (isAllowedConflictFunction(rl, name)) continue
      const body = fn.getBody()
      if (!body) continue
      const bodyText = body.getText()
      // Look for the conflict observation pattern.
      if (!bodyText.includes("'conflict'")) continue
      // It observes the conflict status; is it then doing a follow-up command
      // call with the same payload shape? Heuristic: the body also mentions
      // baseRevision after the conflict observation.
      const conflictIndex = bodyText.indexOf("'conflict'")
      const afterConflict = bodyText.slice(conflictIndex)
      if (
        afterConflict.includes('baseRevision') &&
        (afterConflict.match(/patchSettingsGroup\(|runServerCommand\(|fetch\(/) ?? []).length > 0
      ) {
        fail(
          check,
          `${rl} function ${name} branches on result.status === 'conflict' and resends a mutating command. Surface the conflict; do not replay.`,
          fn,
        )
      }
    }
    // Also walk variable-declared arrow/function expressions at the module level.
    for (const variable of file.getVariableDeclarations()) {
      const init = variable.getInitializer()
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue
      const name = variable.getName()
      if (isAllowedConflictFunction(rl, name)) continue
      const bodyText = init.getText()
      if (!bodyText.includes("'conflict'")) continue
      const conflictIndex = bodyText.indexOf("'conflict'")
      const afterConflict = bodyText.slice(conflictIndex)
      if (
        afterConflict.includes('baseRevision') &&
        (afterConflict.match(/patchSettingsGroup\(|runServerCommand\(|fetch\(/) ?? []).length > 0
      ) {
        fail(
          check,
          `${rl} arrow ${name} branches on 'conflict' and replays a mutating command. Surface conflicts; do not retry.`,
          init,
        )
      }
    }
  }
}

// ----- A4R3: Transitive command-path id minting forbidden -----
//
// Invariant: no function reachable from a `/api/v1/commands/*` route handler
// may call `randomUUID()` / `nanoid()` / `uuidv4()` against a value derived
// from the request body. Helpers that mint only for persisted state
// (repair-on-read) are explicitly classified in `REPAIR_ON_READ_HELPERS`; the
// classification is checked by argument-provenance: the helper's arguments
// in each route call site must be persisted-state bindings, not request
// payload.

// Structural classification of helper functions by name prefix:
//
// - `ensure*` and `normalize*` helpers are NORMALIZE-ON-READ. Their minting
//   repairs degraded persisted state and never originates from client request
//   payloads. They are non-propagating: a call to one of them does not make
//   the caller a "transitive minter." Arg-provenance at the route handler
//   call site verifies the helper receives a persisted-state binding
//   (`target` / `database` / `character` / `chat`), not a request-derived
//   value.
//
// - `repair*` helpers are IMPORT/BOOTSTRAP ONLY. They may be called from
//   import normalizers but must not be reachable from a command-path route
//   handler — directly or transitively. They are propagating.
//
// - Any other function that mints ids transitively is a real violation.

const NON_PROPAGATING_PREFIXES = ['ensure', 'normalize'] as const

function isNonPropagatingHelperName(name: string): boolean {
  return NON_PROPAGATING_PREFIXES.some((prefix) => name.startsWith(prefix))
}

// Per-helper argument allowlist for the route handler call site. The audit
// asserts that when a route handler calls one of these helpers, the FIRST
// argument is one of the listed identifier names (a binding to persisted
// state inside the `mutate(database)` callback). Helpers not in this map are
// classified by prefix only; their arg-provenance defaults to the standard
// `target`/`database` allowlist.
const NORMALIZE_HELPER_ARG_ALLOWLIST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['ensureCharacterChats', new Set(['character', 'target'])],
  ['ensureCharacterChatFolders', new Set(['character'])],
  ['ensureCharacterLorebooks', new Set(['character'])],
  ['ensureChatMessages', new Set(['chat'])],
])

const DEFAULT_NORMALIZE_HELPER_ARGS: ReadonlySet<string> = new Set([
  'target',
  'database',
  'data',
])

function normalizeHelperAllowedArgs(name: string): ReadonlySet<string> {
  return NORMALIZE_HELPER_ARG_ALLOWLIST.get(name) ?? DEFAULT_NORMALIZE_HELPER_ARGS
}

function isUuidMintCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false
  const expression = node.getExpression()
  const name = Node.isIdentifier(expression)
    ? expression.getText()
    : Node.isPropertyAccessExpression(expression)
      ? expression.getName()
      : ''
  return name === 'randomUUID' || name === 'nanoid' || name === 'uuidv4'
}

function findUuidMintCall(node: Node): Node | undefined {
  let match: Node | undefined
  node.forEachDescendant((descendant) => {
    if (match || !isUuidMintCall(descendant)) return
    match = descendant
  })
  return match
}

// Build a project-wide name-to-FunctionDeclaration map for transitive walks.
function buildServerFunctionMap(): Map<string, FunctionDeclaration> {
  const fns = new Map<string, FunctionDeclaration>()
  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('server/fastify/src/')) continue
    for (const fn of file.getFunctions()) {
      const name = fn.getName()
      if (name) fns.set(name, fn)
    }
  }
  return fns
}

function transitivelyMintsUuid(
  fn: FunctionDeclaration,
  fns: ReadonlyMap<string, FunctionDeclaration>,
  seen = new Set<string>(),
): boolean {
  const name = fn.getName()
  if (!name || seen.has(name)) return false
  seen.add(name)
  // Normalize-on-read helpers (`ensure*`/`normalize*`) are the documented
  // mint surface; their minting does not propagate. Their own contract is
  // enforced separately by the arg-provenance check at the route call site.
  if (isNonPropagatingHelperName(name)) return false
  const body = fn.getBody()
  if (!body) return false
  if (findUuidMintCall(body)) return true
  for (const called of calledIdentifierNames(body)) {
    if (isNonPropagatingHelperName(called)) continue
    const calledFn = fns.get(called)
    if (calledFn && transitivelyMintsUuid(calledFn, fns, seen)) return true
  }
  return false
}

function checkAlpha4TransitiveCommandIdMinting(): void {
  const check = 'A4R3 transitive command-path id minting'
  const routes = source('server/fastify/src/routes/commands.ts')
  const fns = buildServerFunctionMap()

  routes.forEachDescendant((node) => {
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

    // Direct mint in the handler body is always wrong (no repair-on-read
    // classification for a route handler).
    const directMint = findUuidMintCall(handler)
    if (directMint) {
      fail(
        check,
        `${method} ${route} mints durable ids directly in the route handler.`,
        directMint,
      )
      return
    }

    // Walk every called identifier in the handler.
    handler.forEachDescendant((descendant) => {
      if (!Node.isCallExpression(descendant)) return
      const callExpression = descendant.getExpression()
      if (!Node.isIdentifier(callExpression)) return
      const calledName = callExpression.getText()
      const calledFn = fns.get(calledName)

      // Direct call to a `repair*` helper from a command-path route is always
      // a violation. Repair helpers are import/bootstrap-only.
      if (calledName.startsWith('repair') && calledFn) {
        // It must contain a UUID call (otherwise its name is misleading; treat
        // the call as informational).
        const body = calledFn.getBody()
        if (body && findUuidMintCall(body)) {
          fail(
            check,
            `${method} ${route} calls repair helper ${calledName}() from a command-path route. Repair helpers are import/bootstrap only; use the validate-only constructor instead.`,
            descendant,
          )
          return
        }
      }

      if (!calledFn) return

      // Normalize-on-read helper: verify arg provenance.
      if (isNonPropagatingHelperName(calledName)) {
        const firstArg = descendant.getArguments()[0]
        if (!firstArg) return
        const argText = firstArg.getText()
        const allowed = normalizeHelperAllowedArgs(calledName)
        if (!allowed.has(argText)) {
          fail(
            check,
            `${method} ${route} calls normalize-on-read helper ${calledName}(${argText}); only ${[...allowed].join('/')} are allowed (persisted-state bindings). Otherwise the helper might mint ids against request-derived data.`,
            descendant,
          )
        }
        return
      }

      // Non-classified helper: must not transitively mint.
      if (transitivelyMintsUuid(calledFn, fns)) {
        fail(
          check,
          `${method} ${route} calls ${calledName}() which transitively reaches a propagating mint (randomUUID()/nanoid()/uuidv4()). Reject missing ids at the validator boundary, or rename the intermediate helper to ensure*/normalize* if it is on-disk normalization (must take persisted-state arg only).`,
          descendant,
        )
      }
    })
  })
}

// ----- A4R4: Every globally-addressed mutation normalizes first -----
//
// Invariant: every route handler that calls a global resolver
// (`requireChatLocation`, `requireMessageLocation`) must invoke the matching
// global normalizer (`normalizeAllCharacterChats`, `normalizeAllChatMessages`)
// earlier in the same handler scope.

interface GlobalResolverPair {
  resolver: string
  normalizer: string
}

const GLOBAL_RESOLVER_PAIRS: readonly GlobalResolverPair[] = [
  { resolver: 'requireChatLocation', normalizer: 'normalizeAllCharacterChats' },
  { resolver: 'requireMessageLocation', normalizer: 'normalizeAllChatMessages' },
]

function checkAlpha4ResolverNormalize(): void {
  const check = 'A4R4 globally-addressed resolver normalize'

  // Apply per-function across all server/fastify/src/. A function that calls
  // a global resolver (directly or via a wrapper) must precede that call
  // with the matching global normalizer in the same scope. This catches both
  // route handlers (the direct case) and shared helpers like
  // `normalizeSelectedChatLorebooks` that wrap the resolver.

  interface OrderedCall {
    name: string
    start: number
    node: Node
  }

  function scanScope(scope: Node, fnName: string, fileLabel: string): void {
    const ordered: OrderedCall[] = []
    scope.forEachDescendant((descendant) => {
      // Do not descend into nested function bodies; those are separate scopes.
      if (Node.isFunctionExpression(descendant) || Node.isArrowFunction(descendant)) {
        return undefined
      }
      if (Node.isFunctionDeclaration(descendant)) return undefined
      if (Node.isMethodDeclaration(descendant)) return undefined
      if (!Node.isCallExpression(descendant)) return
      const callExp = descendant.getExpression()
      if (!Node.isIdentifier(callExp)) return
      ordered.push({ name: callExp.getText(), start: descendant.getStart(), node: descendant })
    })
    ordered.sort((a, b) => a.start - b.start)
    for (const pair of GLOBAL_RESOLVER_PAIRS) {
      const resolverCall = ordered.find((call) => call.name === pair.resolver)
      if (!resolverCall) continue
      const normalizerCalledBefore = ordered.some(
        (call) => call.start < resolverCall.start && call.name === pair.normalizer,
      )
      if (!normalizerCalledBefore) {
        fail(
          check,
          `${fileLabel} ${fnName} calls ${pair.resolver}() without first calling ${pair.normalizer}() in the same scope. Globally-addressed resolvers must run after global id normalization.`,
          resolverCall.node,
        )
      }
    }
  }

  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('server/fastify/src/')) continue
    if (rl.endsWith('.test.ts')) continue
    for (const fn of file.getFunctions()) {
      const name = fn.getName()
      if (!name) continue
      // Skip:
      //   - The resolvers themselves (they ARE the resolver).
      //   - The normalizers (they ARE the normalizer).
      //   - Any `require*` resolver-wrapper helper: it forwards the
      //     normalization responsibility to its callers. The route-handler
      //     scan below catches callers that don't normalize.
      if (
        name === 'requireChatLocation' ||
        name === 'requireMessageLocation' ||
        name === 'normalizeAllCharacterChats' ||
        name === 'normalizeAllChatMessages' ||
        name === 'normalizeGlobalChatIds' ||
        name === 'normalizeGlobalChatFolderIds' ||
        name === 'normalizeGlobalMessageIds' ||
        name.startsWith('require')
      ) {
        continue
      }
      scanScope(fn, name, rl)
    }
    // Inline route handlers are arrow functions in property access calls;
    // they get covered via routes/commands.ts's top-level forEachDescendant.
    if (rl === 'server/fastify/src/routes/commands.ts') {
      file.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return
        const expression = node.getExpression()
        if (!Node.isPropertyAccessExpression(expression)) return
        const method = expression.getName().toUpperCase()
        if (!['POST', 'PATCH', 'PUT', 'DELETE', 'GET', 'HEAD'].includes(method)) return
        const route = node.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralText()
        if (!route?.startsWith('/api/v1/')) return
        const handler = node.getArguments()[1]
        if (!handler || (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler))) {
          return
        }
        scanScope(handler, `${method} ${route}`, rl)
      })
    }
  }
}

// ----- A4R5: Asset reference parser parity (bidirectional) -----
//
// Invariant: the client asset-reference parser and the server asset-reference
// walker accept the same set of legacy shapes. Parity is asserted by
// extracting the regex literal from each side and comparing them.

function getRegexInitializer(sourceFile: SourceFile, name: string): string | undefined {
  const declaration = sourceFile.getVariableDeclaration(name)
  const init = declaration?.getInitializer()
  if (!init) return undefined
  const literal = init.asKind(SyntaxKind.RegularExpressionLiteral)
  if (literal) return literal.getLiteralText()
  // Allow `new RegExp('...')`-style declarations as well.
  if (Node.isNewExpression(init)) {
    const arg = init.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralText()
    if (arg) return `/${arg}/`
  }
  return undefined
}

function findRegexLiteralByText(scope: Node, predicate: (literal: string) => boolean): string | undefined {
  let match: string | undefined
  scope.forEachDescendant((descendant) => {
    if (match) return
    if (Node.isRegularExpressionLiteral(descendant)) {
      const lit = descendant.getLiteralText()
      if (predicate(lit)) match = lit
    }
  })
  return match
}

function checkAlpha4AssetReferenceParity(): void {
  const check = 'A4R5 asset reference parser parity'
  const clientAssets = source('src/ts/server/assets.ts')
  const walker = source('server/fastify/src/risuSave/assetReferences.ts')

  // Client side: extract the LOCAL_ASSET_PATH_RE binding (already exported).
  const clientPattern = getRegexInitializer(clientAssets, 'LOCAL_ASSET_PATH_RE')
  if (!clientPattern) {
    fail(
      check,
      'src/ts/server/assets.ts must declare LOCAL_ASSET_PATH_RE for client/server parity comparison.',
      undefined,
      'src/ts/server/assets.ts',
    )
    return
  }

  // Walker side: accept either a matching named binding OR an inline regex
  // literal in `addReference` whose pattern equals the client's. This avoids
  // forcing a refactor while still asserting structural parity.
  const walkerNamedPattern = getRegexInitializer(walker, 'LOCAL_ASSET_PATH_RE')
  if (walkerNamedPattern) {
    if (walkerNamedPattern !== clientPattern) {
      fail(
        check,
        `Client and walker LOCAL_ASSET_PATH_RE differ: client=${clientPattern} walker=${walkerNamedPattern}. Share a single source of truth.`,
        undefined,
        'server/fastify/src/risuSave/assetReferences.ts',
      )
    }
    return
  }

  const addReference = walker.getFunction('addReference')
  if (!addReference) {
    fail(
      check,
      'server/fastify/src/risuSave/assetReferences.ts must export addReference for parity comparison.',
      undefined,
      'server/fastify/src/risuSave/assetReferences.ts',
    )
    return
  }
  // Any regex literal inside addReference whose pattern equals the client's
  // counts as parity. If none does, fail.
  const matchingLiteral = findRegexLiteralByText(addReference, (lit) => lit === clientPattern)
  if (!matchingLiteral) {
    fail(
      check,
      `Walker addReference does not contain a regex literal equal to client LOCAL_ASSET_PATH_RE (${clientPattern}). Import the shared regex or update the walker to accept the same shapes.`,
      addReference,
    )
  }
}

// ----- A4R6: Wildcard array secrets derive identity from SECRET_PATHS -----
//
// Invariant: every wildcard-array entry in `SECRET_PATHS` has a corresponding
// entry in `ARRAY_ROW_IDENTITY_KEYS`, and the placeholder resolver rejects
// missing/duplicated/unknown row identity rather than restoring by index.

function extractWildcardArrayKeys(sourceFile: SourceFile): {
  rowIdentityRequired: string[]
  flatArrayOfStrings: string[]
} {
  // SECRET_PATHS is an array of arrays. Each inner array's first element is
  // an array-segment name; the SECOND element is `WILDCARD` (an identifier).
  // We split into two classes:
  //   - rowIdentityRequired: path length ≥ 3, so the array contains objects
  //     and the secret is at a nested key; needs ARRAY_ROW_IDENTITY_KEYS.
  //   - flatArrayOfStrings: path length === 2, the secret IS the array value.
  //     Row identity is not applicable; a separate guard is required.
  const declaration = sourceFile.getVariableDeclaration('SECRET_PATHS')
  let initializer = declaration?.getInitializer()
  while (initializer && Node.isAsExpression(initializer)) {
    initializer = initializer.getExpression()
  }
  const outer = initializer?.asKind(SyntaxKind.ArrayLiteralExpression)
  if (!outer) return { rowIdentityRequired: [], flatArrayOfStrings: [] }
  const rowIdentityRequired: string[] = []
  const flatArrayOfStrings: string[] = []
  for (const element of outer.getElements()) {
    const inner = element.asKind(SyntaxKind.ArrayLiteralExpression)
    if (!inner) continue
    const items = inner.getElements()
    if (items.length < 2) continue
    const first = items[0].asKind(SyntaxKind.StringLiteral)?.getLiteralText()
    const second = items[1].asKind(SyntaxKind.Identifier)?.getText()
    if (!first || second !== 'WILDCARD') continue
    if (items.length >= 3) rowIdentityRequired.push(first)
    else flatArrayOfStrings.push(first)
  }
  return { rowIdentityRequired, flatArrayOfStrings }
}

function extractIdentityKeyNames(sourceFile: SourceFile): Set<string> {
  const declaration = sourceFile.getVariableDeclaration('ARRAY_ROW_IDENTITY_KEYS')
  let initializer = declaration?.getInitializer()
  while (initializer && Node.isAsExpression(initializer)) {
    initializer = initializer.getExpression()
  }
  const obj = initializer?.asKind(SyntaxKind.ObjectLiteralExpression)
  if (!obj) return new Set()
  const names = new Set<string>()
  for (const property of obj.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue
    const nameNode = property.getNameNode()
    if (Node.isStringLiteral(nameNode)) names.add(nameNode.getLiteralText())
    else if (Node.isIdentifier(nameNode)) names.add(nameNode.getText())
  }
  return names
}

// Flat array-of-strings secrets (path length 2, ending in WILDCARD) cannot use
// row identity. The audit accepts them only if explicitly classified here,
// with rationale describing the alternate guard (e.g. shape-checked patch).
const FLAT_ARRAY_SECRETS_CLASSIFIED: ReadonlySet<string> = new Set([
  // `['OaiCompAPIKeys', WILDCARD]`: array-of-strings of OpenAI-compatible API
  // keys. Restored by index, accepted today because the array shape never
  // changes through commands (it is replaced wholesale, not reordered). Future
  // work may either drop this restoration entirely or introduce a shape-pinned
  // guard.
  'OaiCompAPIKeys',
])

function checkAlpha4WildcardSecretIdentity(): void {
  const check = 'A4R6 wildcard secret row identity'
  const providerSecrets = source('server/fastify/src/providerSecrets.ts')
  const { rowIdentityRequired, flatArrayOfStrings } = extractWildcardArrayKeys(providerSecrets)
  if (rowIdentityRequired.length === 0 && flatArrayOfStrings.length === 0) {
    fail(
      check,
      'Could not extract wildcard arrays from SECRET_PATHS; audit derivation is stale.',
      undefined,
      'server/fastify/src/providerSecrets.ts',
    )
    return
  }
  const identityKeys = extractIdentityKeyNames(providerSecrets)
  for (const arrayKey of rowIdentityRequired) {
    if (!identityKeys.has(arrayKey)) {
      fail(
        check,
        `Wildcard array secret ${arrayKey} in SECRET_PATHS has no entry in ARRAY_ROW_IDENTITY_KEYS. Add a stable row identity key or remove the secret path.`,
        providerSecrets.getVariableDeclaration('ARRAY_ROW_IDENTITY_KEYS'),
      )
    }
  }
  for (const arrayKey of flatArrayOfStrings) {
    if (!FLAT_ARRAY_SECRETS_CLASSIFIED.has(arrayKey)) {
      fail(
        check,
        `Flat array-of-strings secret ${arrayKey} in SECRET_PATHS has no row identity available. Either reject masked placeholders for this path or add ${arrayKey} to FLAT_ARRAY_SECRETS_CLASSIFIED with rationale.`,
        providerSecrets.getVariableDeclaration('SECRET_PATHS'),
      )
    }
  }

  const providerText = providerSecrets.getFullText()
  if (!providerText.includes('MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED')) {
    fail(
      check,
      'providerSecrets.ts must export MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED so the placeholder resolver can reject unprovable row identity.',
      undefined,
      'server/fastify/src/providerSecrets.ts',
    )
  }

  // The resolver function must reject when identity is missing/duplicated/unknown.
  const resolveBody = getFunctionBodyText(providerSecrets, 'resolveArrayWildcard')
  if (!resolveBody) {
    fail(
      check,
      'providerSecrets.ts must define resolveArrayWildcard for wildcard array restoration.',
      undefined,
      'server/fastify/src/providerSecrets.ts',
    )
    return
  }
  for (const needle of [
    'MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED',
  ]) {
    if (!resolveBody.includes(needle)) {
      fail(
        check,
        `resolveArrayWildcard must reference ${needle}. Otherwise unprovable identity falls through silently.`,
        providerSecrets.getFunction('resolveArrayWildcard'),
      )
    }
  }
}

// ----- A4R7: Asset-URL helpers gate to documented shapes -----
//
// Invariant: every helper in `src/ts/` that returns or fetches a server asset
// URL must, in its Fastify-mode branch, accept only documented shapes (raw
// 64-char asset id, legacy `assets/<sha>.<ext>`, `data:`, `blob:`, absolute
// `/api/v1/assets/...`). Unknown shapes must throw or return a documented
// placeholder.

interface AssetUrlHelperRule {
  file: string
  fn: string
  // Either the function MUST contain a throw on unknown shapes (helper is a
  // bytes-reader), or the function MUST guard the unknown-shape fallback
  // behind a known shape check (helper is a URL-getter).
  mode: 'throw' | 'shape-gate'
  // The gating expression the helper must evaluate before returning `loc`.
  // Empty for `throw` mode.
  shapeGates: readonly string[]
}

const ASSET_URL_HELPERS: readonly AssetUrlHelperRule[] = [
  {
    file: 'src/ts/server/assets.ts',
    fn: 'readServerAssetBytes',
    mode: 'throw',
    shapeGates: [],
  },
  {
    file: 'src/ts/globalApi.svelte.ts',
    fn: 'getFileSrc',
    mode: 'shape-gate',
    shapeGates: ['isFastifyServer'],
  },
]

function checkAlpha4AssetUrlGate(): void {
  const check = 'A4R7 asset URL gate'
  for (const rule of ASSET_URL_HELPERS) {
    const file = source(rule.file)
    const fn = file.getFunction(rule.fn)
    if (!fn) {
      fail(check, `Expected asset URL helper ${rule.fn} in ${rule.file}.`, undefined, rule.file)
      continue
    }
    const body = fn.getBody()
    if (!body) continue
    const bodyText = body.getText()
    if (rule.mode === 'throw') {
      if (!bodyText.includes('throw new Error') && !bodyText.includes('throw ')) {
        fail(
          check,
          `${rule.fn} in ${rule.file} must throw on unsupported asset references before attaching risu-auth.`,
          fn,
        )
      }
      // It must not fall back to fetching the raw `loc` while attaching auth.
      if (
        bodyText.includes("'risu-auth':") &&
        /serverAssetUrl\([^)]*\)\s*\?\?\s*loc/.test(bodyText)
      ) {
        fail(
          check,
          `${rule.fn} in ${rule.file} falls back to fetching arbitrary loc values while attaching risu-auth.`,
          fn,
        )
      }
    } else {
      // shape-gate mode: in the Fastify branch the function must explicitly
      // accept a finite set of shapes and reject unknowns. The rule asserts:
      //   1. There is a Fastify-mode branch at all.
      //   2. No `?? loc` fall-through inside that branch (the literal
      //      "unknown shape → return raw loc" anti-pattern).
      //   3. The branch documents the unknown-shape default by either
      //      returning an empty string/null OR throwing.
      let fastifyBranchText: string | undefined
      body.forEachDescendant((descendant) => {
        if (fastifyBranchText) return
        if (!Node.isIfStatement(descendant)) return
        const cond = descendant.getExpression()
        const condText = cond.getText()
        if (!condText.includes('isFastifyServer')) return
        const thenBlock = descendant.getThenStatement()
        fastifyBranchText = thenBlock.getText()
      })
      if (!fastifyBranchText) {
        fail(
          check,
          `${rule.fn} in ${rule.file} must guard its asset URL handling on isFastifyServer.`,
          fn,
        )
        continue
      }
      if (/\?\?\s*loc\b/.test(fastifyBranchText)) {
        fail(
          check,
          `${rule.fn} in ${rule.file} falls back to \`?? loc\` for unknown asset shapes; restrict to a documented set or return ''/throw.`,
          fn,
        )
      }
      const hasUnknownShapeGuard =
        /\?\?\s*''/.test(fastifyBranchText) ||
        /\?\?\s*null\b/.test(fastifyBranchText) ||
        /return\s+''/.test(fastifyBranchText) ||
        /return\s+null\b/.test(fastifyBranchText) ||
        /throw\s/.test(fastifyBranchText)
      if (!hasUnknownShapeGuard) {
        fail(
          check,
          `${rule.fn} in ${rule.file} must explicitly reject unknown asset shapes by returning '' or throwing.`,
          fn,
        )
      }
    }
  }
}

// ----- A4R-fanout: ≥2 unawaited mutating dispatches in one scope -----
//
// Invariant: no function dispatches two or more mutating server commands
// (named `runServerCommand`, `runChatCommand`, or any export from
// `src/ts/chatCommands.ts` whose name starts with `dispatch`) within the same
// scope without serializing them through `runChatCommandSequence` or by
// awaiting each previous call. Composite fan-out against one optimistic
// snapshot races on the cached command revision.

// Source files that export `dispatch*` mutating helpers. Add new ones here
// when a fresh command family lands; the audit then auto-includes its
// dispatchers in the fan-out scan.
const DISPATCH_SOURCE_FILES = [
  'src/ts/chatCommands.ts',
  'src/ts/characterCommands.ts',
  'src/ts/moduleCommands.ts',
  'src/ts/server/scriptDefinitionBridge.svelte.ts',
  'src/ts/server/lorebookBridge.svelte.ts',
] as const

function findMutatingDispatcherNames(): Set<string> {
  const names = new Set<string>(['runServerCommand', 'runChatCommand'])
  for (const file of DISPATCH_SOURCE_FILES) {
    const absolute = path.join(root, file)
    if (!fs.existsSync(absolute)) continue
    // .svelte.ts files load via the project; pure-ts via source().
    const sf = project.getSourceFile(absolute)
    if (!sf) continue
    for (const fn of sf.getFunctions()) {
      if (!fn.isExported()) continue
      const fnName = fn.getName()
      if (!fnName) continue
      if (fnName.startsWith('dispatch')) names.add(fnName)
    }
  }
  return names
}

// Functions/helpers that intentionally serialize multiple dispatches.
const ALLOWED_FANOUT_SEQUENCERS = new Set<string>([
  'runChatCommandSequence',
  'runOptimisticCommandSequence',
])

// Exemptions for specific declaration names where fan-out is provably safe
// because the function only dispatches one command and the apparent multiple
// callers operate on different snapshots. Keep this list short and document.
const FANOUT_EXEMPT_DECLARATIONS = new Set<string>([
  // The sequencer itself dispatches in series internally.
  'runChatCommandSequence',
  'runOptimisticCommandSequence',
])

function isBranchExclusiveDispatch(call: Node): boolean {
  // A dispatch is "branch-exclusive" if it sits inside a Block that ends in
  // a top-level `return` statement — i.e., the block is a guarded branch
  // (typically `if (cond) { dispatch(...); return }` or a switch-case
  // pattern with early-return). Such dispatches don't race siblings; only
  // one fires per invocation. Excluding them keeps the rule focused on the
  // genuine "≥2 dispatches sharing one optimistic snapshot" anti-pattern.
  let cursor: Node | undefined = call.getParent()
  while (cursor) {
    if (Node.isBlock(cursor)) {
      const statements = cursor.getStatements()
      const last = statements[statements.length - 1]
      if (last && Node.isReturnStatement(last)) return true
      // Otherwise climb out: a containing block without an early-return
      // doesn't make this dispatch exclusive on its own.
      cursor = cursor.getParent()
      continue
    }
    if (
      Node.isFunctionDeclaration(cursor) ||
      Node.isMethodDeclaration(cursor) ||
      Node.isArrowFunction(cursor) ||
      Node.isFunctionExpression(cursor) ||
      Node.isSourceFile(cursor)
    ) {
      return false
    }
    cursor = cursor.getParent()
  }
  return false
}

function countDispatchesInScope(scope: Node, dispatcherNames: ReadonlySet<string>): Node[] {
  const matches: Node[] = []
  scope.forEachDescendant((descendant) => {
    // FunctionDeclarations and class methods are separate top-level scopes —
    // do not descend into them. ArrowFunctions and FunctionExpressions are
    // closures (often inline callbacks like
    // `withTrustedServerProjectionWrite(() => { ... })`) that share the
    // enclosing optimistic snapshot, so we DO descend into them.
    if (Node.isFunctionDeclaration(descendant)) return undefined
    if (Node.isMethodDeclaration(descendant)) return undefined
    if (!Node.isCallExpression(descendant)) return
    const callExp = descendant.getExpression()
    if (!Node.isIdentifier(callExp)) return
    const callName = callExp.getText()
    if (!dispatcherNames.has(callName)) return
    if (isBranchExclusiveDispatch(descendant)) return
    matches.push(descendant)
  })
  return matches
}

function callIsAwaited(call: Node): boolean {
  let cursor: Node | undefined = call.getParent()
  while (cursor) {
    if (Node.isAwaitExpression(cursor)) return true
    if (Node.isParenthesizedExpression(cursor)) {
      cursor = cursor.getParent()
      continue
    }
    return false
  }
  return false
}

function callIsInsideSequencer(call: Node): boolean {
  let cursor: Node | undefined = call.getParent()
  while (cursor) {
    if (Node.isCallExpression(cursor)) {
      const expression = cursor.getExpression()
      if (Node.isIdentifier(expression) && ALLOWED_FANOUT_SEQUENCERS.has(expression.getText())) {
        return true
      }
    }
    cursor = cursor.getParent()
  }
  return false
}

function reportFanout(check: string, file: string, scopeName: string, calls: readonly Node[]): void {
  const firstCall = calls[0]
  if (!firstCall) return
  const names = calls
    .map((node) => {
      if (!Node.isCallExpression(node)) return ''
      const expression = node.getExpression()
      return Node.isIdentifier(expression) ? expression.getText() : ''
    })
    .filter(Boolean)
    .join(', ')
  fail(
    check,
    `${file} ${scopeName} dispatches ${calls.length} mutating commands (${names}) without serialization. Route through runChatCommandSequence / runOptimisticCommandSequence, await each call, or use a composite server endpoint.`,
    firstCall,
  )
}

function checkAlpha4CompositeFanout(): void {
  const check = 'A4R-fanout composite command race'
  const dispatcherNames = findMutatingDispatcherNames()

  // TypeScript / Svelte<script>-as-ts files we can parse with ts-morph.
  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('src/')) continue
    if (rl.endsWith('.test.ts')) continue

    const visitScope = (scopeNode: Node, scopeName: string): void => {
      const calls = countDispatchesInScope(scopeNode, dispatcherNames)
      const unserialized = calls.filter((call) => !callIsAwaited(call) && !callIsInsideSequencer(call))
      if (unserialized.length >= 2) {
        reportFanout(check, rl, scopeName, unserialized)
      }
    }

    for (const fn of file.getFunctions()) {
      const name = fn.getName() ?? '<anonymous>'
      if (FANOUT_EXEMPT_DECLARATIONS.has(name)) continue
      visitScope(fn, `function ${name}`)
    }
    for (const variable of file.getVariableDeclarations()) {
      const init = variable.getInitializer()
      if (!init) continue
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue
      const name = variable.getName()
      if (FANOUT_EXEMPT_DECLARATIONS.has(name)) continue
      visitScope(init, `arrow ${name}`)
    }
    // Class methods (e.g. MCP handlers, bridge classes).
    for (const klass of file.getClasses()) {
      for (const method of klass.getMethods()) {
        const name = `${klass.getName() ?? 'Class'}.${method.getName()}`
        if (FANOUT_EXEMPT_DECLARATIONS.has(method.getName())) continue
        visitScope(method, `method ${name}`)
      }
    }
  }

  // Svelte files cannot be parsed by ts-morph; do a tolerant text scan.
  // The pattern catches consecutive dispatch* calls with no intervening await.
  const svelteScan = (pattern: string, rl: string): void => {
    const lines = pattern.split(/\r?\n/)
    const dispatchLines: { lineNo: number; lineText: string }[] = []
    const dispatcherRegex = new RegExp(`\\b(${[...dispatcherNames].join('|')})\\(`)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (dispatcherRegex.test(line) && !/\bawait\b/.test(line)) {
        dispatchLines.push({ lineNo: i + 1, lineText: line })
      }
    }
    // Group by adjacency (within 5 lines of one another), but split groups
    // when an `} else {`, `} else if`, or other branch boundary appears
    // between two dispatch calls — those are alternate code paths, not a
    // single fan-out scope.
    const branchBoundary = /^\s*\}\s*else\b|^\s*\}\s*$/
    let group: typeof dispatchLines = []
    const groups: (typeof dispatchLines)[] = []
    const pushGroup = (g: typeof dispatchLines): void => {
      if (g.length >= 2) groups.push(g)
    }
    for (const entry of dispatchLines) {
      if (group.length === 0) {
        group.push(entry)
        continue
      }
      const prev = group[group.length - 1]
      // Check the intervening lines for a branch boundary.
      let crossesBoundary = false
      for (let i = prev.lineNo; i < entry.lineNo - 1; i++) {
        if (branchBoundary.test(lines[i] ?? '')) {
          crossesBoundary = true
          break
        }
      }
      if (!crossesBoundary && entry.lineNo - prev.lineNo <= 5) {
        group.push(entry)
      } else {
        pushGroup(group)
        group = [entry]
      }
    }
    pushGroup(group)
    for (const found of groups) {
      // Check if any of these lines is part of a sequencer call.
      const startLine = found[0].lineNo
      const endLine = found[found.length - 1].lineNo
      const surrounding = lines.slice(Math.max(0, startLine - 3), endLine + 2).join('\n')
      if ([...ALLOWED_FANOUT_SEQUENCERS].some((seq) => surrounding.includes(`${seq}(`))) continue
      fail(
        check,
        `${rl} dispatches ${found.length} mutating commands at lines ${found.map((f) => f.lineNo).join(', ')} without serialization. Route through runChatCommandSequence / runOptimisticCommandSequence.`,
        undefined,
        rl,
      )
    }
  }

  // Svelte files we know contain mutating dispatchers from earlier audits.
  const sveltePaths = [
    'src/lib/SideBars/SideChatList.svelte',
  ]
  for (const rl of sveltePaths) {
    const absolute = path.join(root, rl)
    if (!fs.existsSync(absolute)) continue
    svelteScan(fs.readFileSync(absolute, 'utf-8'), rl)
  }
}

// ----- A4R-backup: every dataDir child is in createBackup and restoreBackup -----
//
// Invariant: each subdirectory or file produced by Fastify under `dataDir`
// (the server-owned data directory root) is snapshotted by `createBackup` and
// restored by `restoreBackup`. The inventory is declared in repository.ts as
// `KNOWN_DATA_DIR_CHILDREN` and enforced here.

function checkAlpha4BackupInventory(): void {
  const check = 'A4R-backup data dir inventory'
  const repository = source('server/fastify/src/repository.ts')
  const children = getStringArray(repository, 'KNOWN_DATA_DIR_CHILDREN')
  if (children.length === 0) {
    fail(
      check,
      'repository.ts must declare KNOWN_DATA_DIR_CHILDREN (the exhaustive list of dataDir children to back up).',
      undefined,
      'server/fastify/src/repository.ts',
    )
    return
  }
  const createBody = getFunctionBodyText(repository, 'createBackup')
  const restoreBody = getFunctionBodyText(repository, 'restoreBackup')
  for (const child of children) {
    if (!createBody.includes(child)) {
      fail(
        check,
        `createBackup must reference ${JSON.stringify(child)} (declared in KNOWN_DATA_DIR_CHILDREN).`,
        repository.getFunction('createBackup'),
      )
    }
    if (!restoreBody.includes(child)) {
      fail(
        check,
        `restoreBackup must reference ${JSON.stringify(child)} (declared in KNOWN_DATA_DIR_CHILDREN).`,
        repository.getFunction('restoreBackup'),
      )
    }
  }
}

// ----- A4R-bounded: process-lifetime accumulators are bounded -----
//
// Invariant: every process-lifetime mutable collection in
// `server/fastify/src/` that is written from a request handler must have a
// documented bound. The audit identifies candidate collections by AST and
// asserts each is in `BOUNDED_ACCUMULATOR_DECLARATIONS` with rationale.

interface BoundedAccumulatorDeclaration {
  file: string
  // The text expression that selects the collection (e.g. property access).
  expression: string
  rationale: string
}

const BOUNDED_ACCUMULATOR_DECLARATIONS: readonly BoundedAccumulatorDeclaration[] = [
  {
    file: 'server/fastify/src/auth.ts',
    expression: 'state.knownKeyHashes',
    rationale: 'soft cap with LRU eviction by last-seen; persisted on every register',
  },
  {
    file: 'server/fastify/src/commands/events.ts',
    expression: 'this.events',
    rationale: 'bounded to COMMAND_EVENT_HISTORY_LIMIT (1000) entries on emit',
  },
]

function checkAlpha4BoundedAccumulators(): void {
  const check = 'A4R-bounded process-lifetime accumulators'
  // Surface assertion: each declared bounded accumulator must have an
  // accompanying enforcement reference in the file (e.g. an `eviction`/`splice`/
  // `slice` call that trims the collection). This is a minimum sanity check;
  // the rationale string documents the chosen policy.
  for (const decl of BOUNDED_ACCUMULATOR_DECLARATIONS) {
    const fileText = text(decl.file)
    if (!fileText.includes(decl.expression)) {
      fail(
        check,
        `Bounded accumulator declaration is stale: ${decl.expression} not found in ${decl.file}.`,
        undefined,
        decl.file,
      )
      continue
    }
    const hasTrim =
      /\.splice\(/.test(fileText) ||
      /\.slice\(/.test(fileText) ||
      /\.delete\(/.test(fileText) ||
      /\.clear\(/.test(fileText)
    if (!hasTrim) {
      fail(
        check,
        `Bounded accumulator ${decl.expression} in ${decl.file} has no visible eviction (splice/slice/delete/clear). Rationale was: ${decl.rationale}.`,
        undefined,
        decl.file,
      )
    }
  }

  // Drift detection: walk top-level Set/Map/Array declarations in
  // server/fastify/src/ and class fields of those types. For each that is
  // written by a request handler (heuristic: same file imports a route
  // registrar or is part of a route file), require that it is in
  // BOUNDED_ACCUMULATOR_DECLARATIONS or has a bound comment marker.
  const boundedFiles = new Set(BOUNDED_ACCUMULATOR_DECLARATIONS.map((d) => d.file))
  const ACCUMULATOR_TYPES = new Set(['Set', 'Map', 'Array'])
  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('server/fastify/src/')) continue
    if (rl.endsWith('.test.ts')) continue

    // Skim top-level variable declarations.
    for (const variable of file.getVariableDeclarations()) {
      const init = variable.getInitializer()
      if (!init) continue
      let typeName = ''
      if (Node.isNewExpression(init)) {
        const expression = init.getExpression()
        if (Node.isIdentifier(expression)) typeName = expression.getText()
      }
      if (!ACCUMULATOR_TYPES.has(typeName)) continue
      // Only worry about exported/module-level top-level declarations.
      if (variable.getVariableStatement()?.isExported() !== true) continue

      // Whitelist if the file is already in BOUNDED_ACCUMULATOR_DECLARATIONS.
      if (boundedFiles.has(rl)) continue
      // Otherwise require a marker comment near the declaration.
      const stmt = variable.getVariableStatement()
      const stmtText = stmt?.getFullText() ?? ''
      if (!stmtText.includes('// audit:bounded')) {
        fail(
          check,
          `Top-level ${typeName} ${variable.getName()} in ${rl} is a process-lifetime accumulator; add to BOUNDED_ACCUMULATOR_DECLARATIONS or annotate with // audit:bounded(<policy>).`,
          variable,
        )
      }
    }
  }
}

// ----- A4R-saveasset: every saveAsset caller declares classification -----
//
// Invariant: every call to `saveAsset(bytes, ...)` either:
//   - passes a real filename string (arg index 2), so the persisted metadata
//     honestly records the extension/content-type, OR
//   - is annotated with a leading `// audit:image-default` comment that
//     declares the call is intentionally PNG-defaulted.
// Non-annotated callers without a filename default to PNG metadata, which is
// the B7 bug. The audit asserts every call site picks one of the two paths.

const IMAGE_DEFAULT_MARKER = 'audit:image-default'

function callHasImageDefaultMarker(node: Node): boolean {
  // Walk up to the enclosing block, checking leading comment ranges on every
  // node along the way (statements, blocks, conditional bodies). Comments
  // attached to an enclosing `if`/`else`/`return` count as marking the call,
  // so the marker can sit just above the inner block.
  let cursor: Node | undefined = node
  let depth = 0
  while (cursor && depth < 8) {
    const comments = cursor.getLeadingCommentRanges?.()
    if (comments) {
      for (const range of comments) {
        if (range.getText().includes(IMAGE_DEFAULT_MARKER)) return true
      }
    }
    const parent: Node | undefined = cursor.getParent()
    if (!parent) break
    cursor = parent
    depth += 1
    if (Node.isBlock(parent)) {
      // Inspect the block's own leading comments AND the enclosing
      // statement that hosts the block (if/for/while/etc.). The marker is
      // commonly attached one level above the block where the call lives.
      const blockComments = parent.getLeadingCommentRanges?.()
      if (blockComments) {
        for (const range of blockComments) {
          if (range.getText().includes(IMAGE_DEFAULT_MARKER)) return true
        }
      }
      const blockParent = parent.getParent()
      if (blockParent) {
        const enclosingComments = blockParent.getLeadingCommentRanges?.()
        if (enclosingComments) {
          for (const range of enclosingComments) {
            if (range.getText().includes(IMAGE_DEFAULT_MARKER)) return true
          }
        }
      }
      break
    }
    if (Node.isSourceFile(parent)) break
  }
  return false
}

function checkAlpha4SaveAssetClassification(): void {
  const check = 'A4R-saveasset filename classification'
  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('src/')) continue
    if (rl.endsWith('.test.ts')) continue
    file.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return
      const expression = node.getExpression()
      const callName = Node.isIdentifier(expression)
        ? expression.getText()
        : Node.isPropertyAccessExpression(expression)
          ? expression.getName()
          : ''
      if (callName !== 'saveAsset') return
      // saveAsset signature: `saveAsset(data, customId = '', fileName = '')`.
      // The fileName (arg index 2) determines the persisted extension /
      // content-type. Without it the server defaults to PNG metadata even
      // for non-image bytes.
      const args = node.getArguments()
      const fileNameArg = args[2]
      if (fileNameArg) {
        // If arg 2 is a non-empty string literal, that's a filename — pass.
        // An empty string literal requires the image-default marker.
        const literal = fileNameArg.asKind(SyntaxKind.StringLiteral)
        if (literal && literal.getLiteralText() === '') {
          if (!callHasImageDefaultMarker(node)) {
            fail(
              check,
              `${rl} calls saveAsset(..., '', '') with an empty filename literal. Either pass a real filename or annotate the call with // ${IMAGE_DEFAULT_MARKER} (with rationale).`,
              node,
            )
          }
        }
        // Non-empty literal or variable: assume the caller passes a real
        // filename. The audit can be tightened later if drift appears.
        return
      }
      // Arg 2 omitted: no filename. Caller must be annotated image-default.
      if (!callHasImageDefaultMarker(node)) {
        fail(
          check,
          `${rl} calls saveAsset(bytes) without a filename; the server will record image/png metadata even for non-image bytes. Either pass a real filename as the third argument, or annotate the call with a leading // ${IMAGE_DEFAULT_MARKER} comment (with rationale).`,
          node,
        )
      }
    })
  }
}

function selectedChecks(checks: AuditCheck[]): AuditCheck[] {
  const selected = process.env.CLIENT_THINNING_AUDIT_CHECK_IDS
  if (!selected) return checks

  const ids = selected
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length === 0) return checks

  const byId = new Map(checks.map((check) => [check.id, check]))
  const missing = ids.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    findings.push({
      check: 'audit check selector',
      message: `Unknown CLIENT_THINNING_AUDIT_CHECK_IDS value(s): ${missing.join(', ')}`,
    })
  }

  return ids.flatMap((id) => {
    const check = byId.get(id)
    return check ? [check] : []
  })
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

const auditChecks: AuditCheck[] = [
  { id: 'EC5 active-writer guard', run: checkActiveWriterGuard },
  { id: 'EC4 stable command ids', run: checkStableIdCommandPaths },
  { id: 'EC2 plugin storage gates', run: checkPluginStorageGates },
  { id: 'EC6 asset walker validator drift', run: checkAssetWalkerValidators },
  { id: 'AEC2 import/export current shape', run: checkRisuSaveImportExportShape },
  { id: 'AEC4 chat folder identity scope', run: checkChatFolderIdentityScope },
  { id: 'AEC5 module reference semantics', run: checkModuleReferenceSemantics },
  { id: 'AEC6 asset persistence semantics', run: checkAssetPersistenceSemantics },
  { id: 'EC1 provider ownership', run: checkProviderOwnership },
  { id: 'A4R1 passive refresh writer ownership', run: checkAlpha4PassiveRefresh },
  { id: 'A4R2 conflict replay outside central wrapper', run: checkAlpha4ConflictRetry },
  { id: 'A4R3 transitive command-path id minting', run: checkAlpha4TransitiveCommandIdMinting },
  { id: 'A4R4 globally-addressed resolver normalize', run: checkAlpha4ResolverNormalize },
  { id: 'A4R5 asset reference parser parity', run: checkAlpha4AssetReferenceParity },
  { id: 'A4R6 wildcard secret row identity', run: checkAlpha4WildcardSecretIdentity },
  { id: 'A4R7 asset URL gate', run: checkAlpha4AssetUrlGate },
  { id: 'A4R-fanout composite command race', run: checkAlpha4CompositeFanout },
  { id: 'A4R-backup data dir inventory', run: checkAlpha4BackupInventory },
  { id: 'A4R-bounded process-lifetime accumulators', run: checkAlpha4BoundedAccumulators },
  { id: 'A4R-saveasset filename classification', run: checkAlpha4SaveAssetClassification },
]

runChecks(selectedChecks(auditChecks))

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
