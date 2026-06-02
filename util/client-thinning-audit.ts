import fs from 'node:fs'
import path from 'node:path'
import { Node, Project, SourceFile, SyntaxKind, type FunctionDeclaration } from 'ts-morph'
import {
  PROTOCOL_ROUTE_MANIFEST,
  findProtocolRouteDecision,
  isProtocolMutatingMethod,
  protocolRouteMatches,
  routeRequiresActiveWriter,
  type ProtocolRouteManifestEntry,
} from '../server/fastify/src/routeManifest.js'

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
  'server/fastify/src/routeManifest.ts',
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
  'src/ts/process/request/serverPromptAssembly.ts',
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

function isMutatingMethod(method: string): boolean {
  return isProtocolMutatingMethod(method)
}

function classifyMutatingRoute(route: RouteRegistration): ProtocolRouteManifestEntry | undefined {
  return findProtocolRouteDecision(route.method, route.route)
}

function routeKey(route: Pick<RouteRegistration, 'method' | 'route'>): string {
  return `${route.method} ${route.route}`
}

function assertProtocolManifestMutatingEntriesAreLive(
  check: string,
  mutatingRoutes: readonly RouteRegistration[],
): void {
  for (const entry of PROTOCOL_ROUTE_MANIFEST) {
    const mutatingMethods = entry.methods.filter((method) => isProtocolMutatingMethod(method))
    if (mutatingMethods.length === 0) continue
    if (!entry.path.startsWith('/api/v1/')) continue

    const matchingRoutes = mutatingRoutes.filter((route) =>
      protocolRouteMatches(entry, route.method, route.route),
    )
    if (matchingRoutes.length === 0) {
      const methods = mutatingMethods.join('/')
      fail(
        check,
        `protocol route manifest entry is stale: no discovered ${methods} ${entry.path}.`,
        undefined,
        'server/fastify/src/routeManifest.ts',
      )
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
    'registerRealmImportRoutes(',
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
  if (!activeWriterText.includes('routeRequiresActiveWriter(method, path)')) {
    fail(
      check,
      'active-writer classifier must be driven by the shared protocol route manifest.',
      undefined,
      'server/fastify/src/activeWriter.ts',
    )
  }

  const routeFiles = project
    .getSourceFiles()
    .filter((file) => rel(file).startsWith('server/fastify/src/routes/'))
  const mutatingRoutes = routeRegistrations(routeFiles).filter((route) =>
    isMutatingMethod(route.method),
  )
  if (mutatingRoutes.length === 0) {
    fail(check, 'No mutating Fastify routes were discovered; audit route extraction is stale.')
  }

  assertProtocolManifestMutatingEntriesAreLive(check, mutatingRoutes)

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

    const manifestRequiresWriter = classification.activeWriter.decision === 'active-writer'
    const runtimeRequiresWriter = routeRequiresActiveWriter(route.method, route.route)
    if (manifestRequiresWriter !== runtimeRequiresWriter) {
      fail(
        check,
        `active-writer manifest/runtime mismatch for ${routeKey(route)} (${classification.activeWriter.reason}).`,
        undefined,
        'server/fastify/src/routeManifest.ts',
      )
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
    // Lorebook command-path validators reject missing or duplicate ids without
    // repair-on-read minting.
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

// `scope` reaches a device-local storage sink (a browser storage global or a
// declared localforage instance), by identifier or string-literal reference,
// descending into nested closures.
function referencesDeviceLocalSink(scope: Node, sinks: ReadonlySet<string>): boolean {
  let found = false
  scope.forEachDescendant((descendant, traversal) => {
    if (Node.isIdentifier(descendant) && sinks.has(descendant.getText())) {
      found = true
      traversal.stop()
      return
    }
    if (
      (Node.isStringLiteral(descendant) || Node.isNoSubstitutionTemplateLiteral(descendant)) &&
      sinks.has(descendant.getLiteralText())
    ) {
      found = true
      traversal.stop()
    }
  })
  return found
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

  // Any method or accessor that reaches browser storage globals or a localforage
  // instance must assert Plugin Compatibility Mode first.
  const deviceLocalSinks = new Set<string>([
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'caches',
    'cookieStore',
    'localforage',
  ])
  for (const declaration of safeClass.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer()
    if (!initializer || !Node.isCallExpression(initializer)) continue
    const callee = initializer.getExpression()
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'createInstance') {
      const nameNode = declaration.getNameNode()
      if (Node.isIdentifier(nameNode)) deviceLocalSinks.add(nameNode.getText())
    }
  }

  const requireGate = (label: string, scope: Node, sinkKind: string): void => {
    if (!referencesDeviceLocalSink(scope, deviceLocalSinks)) return
    if (scope.getText().includes('assertDeviceLocalPluginStorageEnabled()')) return
    fail(
      check,
      `${label} must assert Plugin Compatibility Mode before touching ${sinkKind}.`,
      scope,
    )
  }

  for (const className of ['SafeLocalStorage', 'SafeLocalPluginStorage']) {
    const klass = safeClass.getClass(className)
    if (!klass) {
      fail(check, `Missing ${className}.`, undefined, safeClass)
      continue
    }
    const members: { name: string; node: Node }[] = [
      ...klass.getMethods().map((member) => ({ name: member.getName(), node: member as Node })),
      ...klass
        .getGetAccessors()
        .map((member) => ({ name: member.getName(), node: member as Node })),
      ...klass
        .getSetAccessors()
        .map((member) => ({ name: member.getName(), node: member as Node })),
    ]
    for (const member of members) {
      requireGate(`${className}.${member.name}`, member.node, 'device-local storage')
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
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer()
        if (
          initializer &&
          (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
        ) {
          requireGate(`SafeIdbFactory.${property.getName()}`, property, 'IndexedDB')
        }
      } else if (Node.isMethodDeclaration(property)) {
        requireGate(`SafeIdbFactory.${property.getName()}`, property, 'IndexedDB')
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
    "saveMethod: 'server'",
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
  const addAssetsBody = getFunctionBodyText(repository, 'addAssets')
  const optionalRefBody = getFunctionBodyText(assetCommands, 'validateOptionalServerAssetRef')
  const characterText = text('server/fastify/src/commands/characters.ts')

  if (!addAssetBody.includes('return addAssets(db, dataDir, [args])[0]')) {
    fail(
      check,
      'addAsset must delegate to addAssets so single and bulk uploads share persistence semantics.',
      repository.getFunction('addAsset'),
    )
  }

  for (const needle of [
    'const file = assetPath(dataDir, existing)',
    'if (!fs.existsSync(file))',
    'fs.writeFileSync(file, asset.bytes)',
  ]) {
    if (!addAssetsBody.includes(needle)) {
      fail(
        check,
        `addAssets must heal missing blobs for existing asset metadata; missing ${needle}.`,
        repository.getFunction('addAssets'),
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
    'Provider preview bodies are not supported in Fastify server mode',
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

  // The prompt-assembly classifier mirrors the completion route: it must exist
  // and enforce server-mandatory assembly for the supported text-send subset
  // (no silent local fall-through). See docs/client-thinning/reference/prompt-assembly-classifier.md.
  const serverPromptAssembly = source('src/ts/process/request/serverPromptAssembly.ts')
  const serverPromptAssemblyText = serverPromptAssembly.getFullText()
  for (const needle of [
    'export function resolveServerPromptAssembly',
    'is not supported in Fastify server mode',
  ]) {
    if (!serverPromptAssemblyText.includes(needle)) {
      fail(
        check,
        `serverPromptAssembly classifier is missing the Fastify server-mandatory guard: ${needle}`,
        undefined,
        serverPromptAssembly,
      )
    }
  }
  if (serverPromptAssemblyText.includes('useServerPromptAssembly')) {
    fail(
      check,
      'useServerPromptAssembly must not route Fastify prompt assembly to the browser-local assembler.',
      undefined,
      serverPromptAssembly,
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
  if (settingsKeys.includes('useServerPromptAssembly')) {
    fail(
      check,
      'useServerPromptAssembly must not be exposed as a Fastify server settings command.',
      clientCommands.getVariableDeclaration('SERVER_SETTINGS_GROUP_BY_KEY'),
    )
  }

  const serverCommandRoutes = loadOptionalSource('server/fastify/src/routes/commands.ts')
  if (serverCommandRoutes?.getFullText().includes("'useServerPromptAssembly'")) {
    fail(
      check,
      'useServerPromptAssembly must not be accepted by Fastify settings routes.',
      undefined,
      serverCommandRoutes,
    )
  }
}

// Client-thinning checks below derive their surfaces from source structures
// (function exports, call graphs, AST literals), with each invariant stated
// above its rule.

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

// ----- Shared AST helpers (used by A4R2, A4R7, and A4R-fanout) -----

// Strip parentheses / `as` casts to reach the underlying expression.
function unwrapExpression(node: Node): Node {
  let current = node
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current)) {
    const inner = current.getExpression()
    if (!inner) break
    current = inner
  }
  return current
}

// The simple callee name of a call expression: `foo()` -> `foo`,
// `a.b.foo()` -> `foo`. Undefined for computed / non-call nodes.
function callExpressionCalleeName(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) return undefined
  const expression = call.getExpression()
  if (Node.isIdentifier(expression)) return expression.getText()
  if (Node.isPropertyAccessExpression(expression)) return expression.getName()
  return undefined
}

function isFunctionLikeNode(node: Node): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  )
}

function enclosingFunctionLike(node: Node): Node | undefined {
  let current = node.getParent()
  while (current) {
    if (isFunctionLikeNode(current)) return current
    current = current.getParent()
  }
  return undefined
}

// A human-readable `kind name` for a function-like node, used in findings.
function functionLikeDisplayName(fn: Node): { kind: string; name: string } {
  if (Node.isFunctionDeclaration(fn)) {
    return { kind: 'function', name: fn.getName() ?? '<anonymous>' }
  }
  if (Node.isMethodDeclaration(fn)) {
    const klass = fn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
    return {
      kind: 'method',
      name: `${klass?.getName() ?? 'Class'}.${fn.getName() ?? '<anonymous>'}`,
    }
  }
  if (Node.isGetAccessorDeclaration(fn) || Node.isSetAccessorDeclaration(fn)) {
    return { kind: 'accessor', name: fn.getName() }
  }
  const varDecl = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  if (varDecl) {
    const init = varDecl.getInitializer()
    if (init && unwrapExpression(init) === fn) {
      return { kind: 'arrow', name: varDecl.getName() }
    }
  }
  const propAssignment = fn.getParentIfKind(SyntaxKind.PropertyAssignment)
  if (propAssignment) return { kind: 'property', name: propAssignment.getName() }
  return { kind: 'function', name: '<anonymous>' }
}

// The sibling statements following `statement` in its enclosing block / source.
function statementsAfter(statement: Node): Node[] {
  const parent = statement.getParent()
  if (!parent) return []
  if (!Node.isBlock(parent) && !Node.isSourceFile(parent) && !Node.isModuleBlock(parent)) return []
  const statements = parent.getStatements()
  const index = statements.indexOf(statement as never)
  if (index === -1) return []
  return statements.slice(index + 1)
}

// A statement that only diverts control (an early-return / throw guard),
// possibly wrapped in a single-statement block.
function isControlDivertingGuard(statement: Node | undefined): boolean {
  if (!statement) return false
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) return true
  if (Node.isBlock(statement)) {
    const statements = statement.getStatements()
    const last = statements[statements.length - 1]
    return !!last && (Node.isReturnStatement(last) || Node.isThrowStatement(last))
  }
  return false
}

// ----- A4R2: Conflict replay forbidden outside the central wrapper -----
//
// Invariant: only `runServerCommand` in `src/ts/server/commands.ts` is allowed
// to branch on a command result whose `status === 'conflict'`. Any other
// function that observes that branch and then re-runs a mutating command is a
// blind replay.
//
// This is an AST invariant, not a substring scan. The conflict status is
// matched even when aliased to a local constant (`const C = 'conflict'`); the
// conflict-handling region is located structurally (the matching arm of the
// guarding `if` / ternary, or the statements after an early-return guard); and
// the replay is any mutating command re-issued inside that region
// (`runServerCommand` / `patchSettingsGroup` / `fetch`, a `dispatch*` helper,
// or a recursive self-call). Aliasing the `'conflict'` / `'baseRevision'`
// literals no longer evades it.

const CONFLICT_STATUS_LITERAL = 'conflict'

const ALLOWED_CONFLICT_HANDLERS = new Set<string>([
  // The central command wrapper IS the conflict surface; it is allowed to
  // observe and propagate.
  'runServerCommand',
])

// Mutating command callees whose re-invocation inside a conflict-handling
// region counts as a blind replay. `dispatch*` helpers and recursive
// self-calls are detected structurally in addition to these names.
const CONFLICT_REPLAY_CALLEES = new Set<string>(['runServerCommand', 'patchSettingsGroup', 'fetch'])

const EQUALITY_OPERATOR_KINDS = new Set<SyntaxKind>([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
])

const INEQUALITY_OPERATOR_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
])

function isAllowedConflictFunction(file: string, name: string | undefined): boolean {
  if (!name) return false
  return file === 'src/ts/server/commands.ts' && ALLOWED_CONFLICT_HANDLERS.has(name)
}

// `node` is the string literal `target` after stripping parens / `as` casts.
function isDirectStringLiteral(node: Node, target: string): boolean {
  const inner = unwrapExpression(node)
  return (
    (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner)) &&
    inner.getLiteralText() === target
  )
}

// File-level identifiers bound to the `target` string literal, e.g.
// `const CONFLICT = 'conflict'`. Pure AST — no type environment required, so it
// resolves aliases in the minimal fixture tsconfigs too.
function collectStringLiteralAliases(file: SourceFile, target: string): Set<string> {
  const aliases = new Set<string>()
  for (const declaration of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer()
    if (initializer && isDirectStringLiteral(initializer, target)) {
      const nameNode = declaration.getNameNode()
      if (Node.isIdentifier(nameNode)) aliases.add(nameNode.getText())
    }
  }
  return aliases
}

function valueIsConflictStatus(node: Node, aliases: ReadonlySet<string>): boolean {
  const inner = unwrapExpression(node)
  if (isDirectStringLiteral(inner, CONFLICT_STATUS_LITERAL)) return true
  return Node.isIdentifier(inner) && aliases.has(inner.getText())
}

// The branch region(s) controlled by a condition sub-expression: the arm taken
// when that sub-expression is `takeWhenTrue` (after accounting for `!`
// negations on the path up to the controlling `if` / ternary). Returns the
// matching branch, plus the statements after an early-return guard. Used by
// A4R2 (conflict-status comparison) and optionally by A4R7 when a legacy
// `isFastifyServer` guard is still present; the branch is located regardless
// of guard polarity.
function guardedBranchRegions(conditionNode: Node, takeWhenTrue: boolean): Node[] {
  let current = conditionNode
  let negations = 0
  for (;;) {
    const parent = current.getParent()
    if (!parent) return []
    if (Node.isParenthesizedExpression(parent)) {
      current = parent
      continue
    }
    if (
      Node.isPrefixUnaryExpression(parent) &&
      parent.getOperatorToken() === SyntaxKind.ExclamationToken
    ) {
      negations++
      current = parent
      continue
    }
    if (Node.isBinaryExpression(parent)) {
      // `&&` / `||` combinator — keep climbing toward the controlling guard.
      current = parent
      continue
    }
    const primaryArm = takeWhenTrue !== (negations % 2 === 1)
    if (Node.isConditionalExpression(parent) && parent.getCondition() === current) {
      return [primaryArm ? parent.getWhenTrue() : parent.getWhenFalse()]
    }
    if (Node.isIfStatement(parent) && parent.getExpression() === current) {
      const thenStatement = parent.getThenStatement()
      const elseStatement = parent.getElseStatement()
      if (primaryArm) return thenStatement ? [thenStatement] : []
      const regions: Node[] = []
      if (elseStatement) regions.push(elseStatement)
      if (isControlDivertingGuard(thenStatement)) regions.push(...statementsAfter(parent))
      return regions
    }
    return []
  }
}

function regionReissuesMutatingCommand(region: Node, enclosingName: string | undefined): boolean {
  const isReplayCall = (node: Node): boolean => {
    const name = callExpressionCalleeName(node)
    if (!name) return false
    if (CONFLICT_REPLAY_CALLEES.has(name)) return true
    if (name.startsWith('dispatch')) return true
    return !!enclosingName && name === enclosingName
  }
  if (Node.isCallExpression(region) && isReplayCall(region)) return true
  let found = false
  region.forEachDescendant((descendant, traversal) => {
    if (Node.isCallExpression(descendant) && isReplayCall(descendant)) {
      found = true
      traversal.stop()
    }
  })
  return found
}

function checkAlpha4ConflictRetry(): void {
  const check = 'A4R2 conflict replay outside central wrapper'
  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('src/')) continue
    if (rl.endsWith('.test.ts')) continue
    const aliases = collectStringLiteralAliases(file, CONFLICT_STATUS_LITERAL)
    const reported = new Set<Node>()
    for (const binary of file.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = binary.getOperatorToken().getKind()
      if (!EQUALITY_OPERATOR_KINDS.has(operator)) continue
      if (
        !valueIsConflictStatus(binary.getLeft(), aliases) &&
        !valueIsConflictStatus(binary.getRight(), aliases)
      ) {
        continue
      }
      const enclosing = enclosingFunctionLike(binary)
      if (!enclosing || reported.has(enclosing)) continue
      const { kind, name } = functionLikeDisplayName(enclosing)
      if (isAllowedConflictFunction(rl, name)) continue
      const trueOnConflict = !INEQUALITY_OPERATOR_KINDS.has(operator)
      const regions = guardedBranchRegions(binary, trueOnConflict)
      if (regions.some((region) => regionReissuesMutatingCommand(region, name))) {
        reported.add(enclosing)
        fail(
          check,
          `${rl} ${kind} ${name} branches on result.status === 'conflict' and resends a mutating command. Surface the conflict; do not replay.`,
          binary,
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

const DEFAULT_NORMALIZE_HELPER_ARGS: ReadonlySet<string> = new Set(['target', 'database', 'data'])

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
      fail(check, `${method} ${route} mints durable ids directly in the route handler.`, directMint)
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

function findRegexLiteralByText(
  scope: Node,
  predicate: (literal: string) => boolean,
): string | undefined {
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
  for (const needle of ['MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED']) {
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
// URL must accept only documented shapes (raw 64-char asset id, legacy
// `assets/<sha>.<ext>`, `data:`, `blob:`, absolute `/api/v1/assets/...`).
// Unknown shapes must throw or return a documented placeholder. The gate
// helper `serverAssetUrl` (and the `serverAssetIdFromReference` it may
// delegate to) must itself restrict `loc` to the documented anchored shapes
// and reject the rest with `null`.
//
// This is an AST invariant, not a branch-text heuristic:
//   - The app is Fastify-only, so the entire function body is the Fastify path.
//     If a legacy `isFastifyServer` guard still exists, the check narrows to
//     that branch via `guardedBranchRegions`; otherwise the whole body is used.
//   - The accepted shapes of `serverAssetUrl` are validated rather than
//     assumed, so a refactor that widens them (e.g. an `http(s)://` passthrough)
//     cannot slip past unnoticed.

interface AssetUrlHelperRule {
  file: string
  fn: string
  // `throw`: a bytes-reader that must throw on unknown shapes.
  // `shape-gate`: a URL-getter that must, in its Fastify branch, reject
  // unknown shapes with ''/null/throw and never `?? loc`.
  mode: 'throw' | 'shape-gate'
}

const ASSET_URL_HELPERS: readonly AssetUrlHelperRule[] = [
  { file: 'src/ts/server/assets.ts', fn: 'readServerAssetBytes', mode: 'throw' },
  { file: 'src/ts/globalApi.svelte.ts', fn: 'getFileSrc', mode: 'shape-gate' },
]

// A regex literal anchoring a 64-char hex asset id (the documented
// server-asset shape), e.g. `/^[a-f0-9]{64}$/` or
// `/^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i`.
function hasAnchoredAssetIdRegex(scope: Node): boolean {
  let found = false
  scope.forEachDescendant((descendant, traversal) => {
    if (descendant.getKind() !== SyntaxKind.RegularExpressionLiteral) return
    const literal = descendant.getText()
    if (literal.includes('^') && literal.includes('[a-f0-9]{64}')) {
      found = true
      traversal.stop()
    }
  })
  return found
}

// `scope` applies a regex matcher (`.test` / `.exec` / `.match`) somewhere.
function callsRegexMatcher(scope: Node): boolean {
  let found = false
  scope.forEachDescendant((descendant, traversal) => {
    if (!Node.isCallExpression(descendant)) return
    const expression = descendant.getExpression()
    if (
      Node.isPropertyAccessExpression(expression) &&
      ['test', 'exec', 'match'].includes(expression.getName())
    ) {
      found = true
      traversal.stop()
    }
  })
  return found
}

// `fn` has a `return <name>` of the bare identifier (the raw param passthrough),
// not descending into nested function scopes.
function returnsBareIdentifier(fn: Node, name: string): boolean {
  let found = false
  fn.forEachDescendant((descendant, traversal) => {
    if (descendant !== fn && isFunctionLikeNode(descendant)) {
      traversal.skip()
      return
    }
    if (!Node.isReturnStatement(descendant)) return
    const expression = descendant.getExpression()
    if (!expression) return
    const inner = unwrapExpression(expression)
    if (Node.isIdentifier(inner) && inner.getText() === name) {
      found = true
      traversal.stop()
    }
  })
  return found
}

const REJECTS_UNKNOWN_SHAPE_PATTERNS: readonly RegExp[] = [
  /\?\?\s*''/,
  /\?\?\s*null\b/,
  /return\s+''/,
  /return\s+null\b/,
  /:\s*''/,
  /:\s*null\b/,
  /throw\s/,
]

function rejectsUnknownShape(text: string): boolean {
  return REJECTS_UNKNOWN_SHAPE_PATTERNS.some((pattern) => pattern.test(text))
}

// Validate that `serverAssetUrl` (and any `serverAssetIdFromReference` gate it
// delegates to) restrict `loc` to documented anchored shapes and reject the
// rest with null/''. Without this a refactor could widen the accepted shapes
// and every downstream asset gate would silently widen with it.
function validateServerAssetUrlShapes(check: string): void {
  const file = source('src/ts/server/assets.ts')
  const fn = file.getFunction('serverAssetUrl')
  if (!fn) {
    fail(
      check,
      'Expected serverAssetUrl gate helper in src/ts/server/assets.ts.',
      undefined,
      'src/ts/server/assets.ts',
    )
    return
  }
  const param = fn.getParameters()[0]?.getName() ?? 'loc'
  const body = fn.getBody()
  if (!body) return
  const bodyText = body.getText()

  if (!rejectsUnknownShape(bodyText)) {
    fail(
      check,
      `serverAssetUrl must reject unsupported asset references by returning null/'' (no documented unknown-shape default).`,
      fn,
    )
  }

  if (returnsBareIdentifier(fn, param) || new RegExp(`\\?\\?\\s*${param}\\b`).test(bodyText)) {
    fail(
      check,
      `serverAssetUrl must not pass an unvalidated ${param} through; restrict to documented asset shapes.`,
      fn,
    )
  }

  const delegatesToIdGate = bodyText.includes('serverAssetIdFromReference')
  const inlineRegexGate = hasAnchoredAssetIdRegex(fn) && callsRegexMatcher(fn)
  if (!delegatesToIdGate && !inlineRegexGate) {
    fail(
      check,
      `serverAssetUrl must gate ${param} through serverAssetIdFromReference or an anchored asset-id regex before producing a URL.`,
      fn,
    )
  }

  if (delegatesToIdGate) {
    const idFn = file.getFunction('serverAssetIdFromReference')
    if (!idFn) {
      fail(
        check,
        'serverAssetUrl delegates to serverAssetIdFromReference, which is missing from src/ts/server/assets.ts.',
        fn,
      )
    } else {
      // The anchored regex may be a module-level const referenced by name, so
      // look across the whole file for the literal but require the gate to
      // actually apply a regex matcher and reject non-matches with null.
      if (!hasAnchoredAssetIdRegex(file) || !callsRegexMatcher(idFn)) {
        fail(
          check,
          'serverAssetIdFromReference must match loc against an anchored asset-id regex.',
          idFn,
        )
      }
      const idText = idFn.getBody()?.getText() ?? ''
      if (
        !/\?\?\s*null\b/.test(idText) &&
        !/return\s+null\b/.test(idText) &&
        !/:\s*null\b/.test(idText)
      ) {
        fail(
          check,
          'serverAssetIdFromReference must return null for non-matching asset references.',
          idFn,
        )
      }
    }
  }
}

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
      continue
    }

    // shape-gate mode: the function body is the Fastify path (the app is
    // Fastify-only, so there is no browser branch to exclude). If a legacy
    // `isFastifyServer` guard still exists, narrow to that branch; otherwise
    // the entire body is the region to check. The branch must reject unknown
    // shapes (''/null/throw) and never fall through to `?? loc`.
    const param = fn.getParameters()[0]?.getName() ?? 'loc'
    let regions: Node[] = []
    body.forEachDescendant((descendant, traversal) => {
      if (regions.length) {
        traversal.stop()
        return
      }
      if (!Node.isIdentifier(descendant) || descendant.getText() !== 'isFastifyServer') return
      const candidate = guardedBranchRegions(descendant, true)
      if (candidate.length) regions = candidate
    })
    if (!regions.length) {
      // No isFastifyServer guard — the whole body IS the Fastify path.
      regions = [body]
    }
    const fastifyBranchText = regions.map((region) => region.getText()).join('\n')
    if (new RegExp(`\\?\\?\\s*${param}\\b`).test(fastifyBranchText)) {
      fail(
        check,
        `${rule.fn} in ${rule.file} falls back to \`?? ${param}\` for unknown asset shapes; restrict to a documented set or return ''/throw.`,
        fn,
      )
    }
    if (!rejectsUnknownShape(fastifyBranchText)) {
      fail(
        check,
        `${rule.fn} in ${rule.file} must explicitly reject unknown asset shapes by returning '' or throwing.`,
        fn,
      )
    }
  }

  validateServerAssetUrlShapes(check)
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

// Two nodes whose lowest common ancestor branches them into alternative arms
// (if/else, the two sides of a ternary) never both fire in one invocation, so
// they do not race on the optimistic snapshot.
function lowestCommonAncestor(a: Node, b: Node): Node | undefined {
  const ancestorsOfA = new Set<Node>()
  let cursor: Node | undefined = a
  while (cursor) {
    ancestorsOfA.add(cursor)
    cursor = cursor.getParent()
  }
  cursor = b
  while (cursor) {
    if (ancestorsOfA.has(cursor)) return cursor
    cursor = cursor.getParent()
  }
  return undefined
}

function childOnPathTo(ancestor: Node, descendant: Node): Node | undefined {
  let cursor: Node | undefined = descendant
  while (cursor && cursor.getParent() !== ancestor) {
    cursor = cursor.getParent()
  }
  return cursor
}

function areMutuallyExclusive(a: Node, b: Node): boolean {
  const ancestor = lowestCommonAncestor(a, b)
  if (!ancestor) return false
  const childA = childOnPathTo(ancestor, a)
  const childB = childOnPathTo(ancestor, b)
  if (!childA || !childB || childA === childB) return false
  if (Node.isIfStatement(ancestor)) {
    const arms = new Set<Node>()
    const thenStatement = ancestor.getThenStatement()
    const elseStatement = ancestor.getElseStatement()
    if (thenStatement) arms.add(thenStatement)
    if (elseStatement) arms.add(elseStatement)
    return arms.has(childA) && arms.has(childB)
  }
  if (Node.isConditionalExpression(ancestor)) {
    const arms = new Set<Node>([ancestor.getWhenTrue(), ancestor.getWhenFalse()])
    return arms.has(childA) && arms.has(childB)
  }
  return false
}

function reportFanout(
  check: string,
  file: string,
  scopeName: string,
  calls: readonly Node[],
  locationNode: Node | undefined,
): void {
  if (!calls.length) return
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
    locationNode,
    file,
  )
}

// Extract Svelte markup attribute expressions (`attr={ ... }`, including
// `onclick={...}` event handlers) as raw TS expression text via balanced-brace
// matching that respects string / template literals. Svelte logic blocks
// (`{#each}` / `{:else}` / `{/if}` / `{@const}`) and text interpolations start
// with `{`, not `={`, so they are not matched.
function extractSvelteAttributeExpressions(markup: string): string[] {
  const expressions: string[] = []
  let i = 0
  while (i < markup.length) {
    const anchor = markup.indexOf('={', i)
    if (anchor === -1) break
    let depth = 0
    let inString: string | null = null
    let expression = ''
    let j = anchor + 1 // the opening `{`
    let closed = false
    for (; j < markup.length; j++) {
      const ch = markup[j]
      const prev = j > 0 ? markup[j - 1] : ''
      if (inString) {
        expression += ch
        if (ch === inString && prev !== '\\') inString = null
        continue
      }
      if (ch === '{') {
        depth++
        if (depth > 1) expression += ch
        continue
      }
      if (ch === '}') {
        depth--
        if (depth === 0) {
          closed = true
          break
        }
        expression += ch
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch
        expression += ch
        continue
      }
      expression += ch
    }
    if (closed && expression.trim()) expressions.push(expression)
    i = j + 1
  }
  return expressions
}

// Svelte files whose script or markup can contain mutating dispatchers.
const FANOUT_SVELTE_PATHS = ['src/lib/SideBars/SideChatList.svelte'] as const

function checkAlpha4CompositeFanout(): void {
  const check = 'A4R-fanout composite command race'
  const dispatcherNames = findMutatingDispatcherNames()

  // A scope races when at least two unserialized dispatches can fire in one
  // invocation. Mutually exclusive branches are ignored.
  const visitScope = (
    rl: string,
    scopeNode: Node,
    scopeName: string,
    useNodeLocation: boolean,
  ): void => {
    const calls = countDispatchesInScope(scopeNode, dispatcherNames)
    const unserialized = calls.filter(
      (call) => !callIsAwaited(call) && !callIsInsideSequencer(call),
    )
    const racing = unserialized.filter((call) =>
      unserialized.some((other) => other !== call && !areMutuallyExclusive(call, other)),
    )
    if (racing.length >= 2) {
      reportFanout(check, rl, scopeName, racing, useNodeLocation ? racing[0] : undefined)
    }
  }

  const visitContainer = (rl: string, container: SourceFile, useNodeLocation: boolean): void => {
    for (const fn of container.getFunctions()) {
      const name = fn.getName() ?? '<anonymous>'
      if (FANOUT_EXEMPT_DECLARATIONS.has(name)) continue
      visitScope(rl, fn, `function ${name}`, useNodeLocation)
    }
    for (const variable of container.getVariableDeclarations()) {
      const init = variable.getInitializer()
      if (!init) continue
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue
      const name = variable.getName()
      if (FANOUT_EXEMPT_DECLARATIONS.has(name)) continue
      visitScope(rl, init, `arrow ${name}`, useNodeLocation)
    }
    // Class methods (e.g. MCP handlers, bridge classes).
    for (const klass of container.getClasses()) {
      for (const method of klass.getMethods()) {
        const name = `${klass.getName() ?? 'Class'}.${method.getName()}`
        if (FANOUT_EXEMPT_DECLARATIONS.has(method.getName())) continue
        visitScope(rl, method, `method ${name}`, useNodeLocation)
      }
    }
  }

  // TypeScript files from the shared project.
  for (const file of project.getSourceFiles()) {
    const rl = rel(file)
    if (!rl.startsWith('src/')) continue
    if (rl.endsWith('.test.ts')) continue
    visitContainer(rl, file, true)
  }

  // Parse Svelte scripts and markup handlers into temporary TS sources, then
  // run the same AST scope analysis. Synthetic sources report at file level.
  const scriptBlockPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  for (const rl of FANOUT_SVELTE_PATHS) {
    const absolute = path.join(root, rl)
    if (!fs.existsSync(absolute)) continue
    const svelteText = fs.readFileSync(absolute, 'utf-8')
    const svelteProject = new Project({ useInMemoryFileSystem: true })
    const containers: SourceFile[] = []
    let scriptIndex = 0
    for (const match of svelteText.matchAll(scriptBlockPattern)) {
      containers.push(svelteProject.createSourceFile(`script_${scriptIndex++}.ts`, match[1]))
    }
    const markup = svelteText.replace(scriptBlockPattern, '').replace(/<!--[\s\S]*?-->/g, '')
    extractSvelteAttributeExpressions(markup).forEach((expression, index) => {
      containers.push(
        svelteProject.createSourceFile(
          `handler_${index}.ts`,
          `function __svelteHandler_${index}() {\n  const __expr = (${expression})\n  return __expr\n}`,
        ),
      )
    })
    for (const container of containers) visitContainer(rl, container, false)
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
  // Each declared bounded accumulator must have a visible trim/eviction
  // reference; its rationale documents the chosen policy.
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

  // Any request-reachable top-level Set/Map/Array accumulator must be declared
  // above or carry an audit:bounded marker.
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
// Invariant: every `saveAsset(bytes, ...)` call either passes a real filename or
// carries `audit:image-default` to declare intentional PNG-default metadata.

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
        // Non-empty literals and variables count as filename-providing calls.
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

// ----- A4R-pluginv2: no server-side plugin (V2) execution path -----
//
// Invariant: pluginV2 edit/replacer hooks stay unsupported for server prompt
// assembly because server-side plugin code execution is on the no-port list.
// Both halves are AST-derived so deferral comments in the assembler never trip
// the rule:
//
//   negative — no file in the server assembler (server/fastify/src/prompt/**)
//     may import the browser plugin runtime, reference the `pluginV2` registry,
//     or open a JS eval sandbox (`eval` / `new Function`) that plugin code could
//     be fed into.
//   positive — the client classifier (serverPromptAssembly.ts) must still import
//     the `pluginV2` registry and inspect at least one edit set, so the hard-fail
//     gate cannot be silently deleted (which would let a pluginV2 send fall
//     through to server assembly).
function checkPluginV2NoServerExecution(): void {
  const check = 'A4R-pluginv2 no server-side plugin execution'
  const promptDir = 'server/fastify/src/prompt'
  const absDir = path.join(root, promptDir)
  const pluginRuntimeSpecifier = /\/plugins\/(?:plugins|apiV3)|plugins\.svelte/

  // A missing assembler dir means the fixture has no server execution path to inspect.
  if (fs.existsSync(absDir)) {
    for (const entry of fs.readdirSync(absDir)) {
      if (!entry.endsWith('.ts')) continue
      const relPath = `${promptDir}/${entry}`
      const abs = path.join(root, relPath)
      const sf = project.getSourceFile(abs) ?? project.addSourceFileAtPathIfExists(abs)
      if (!sf) continue

      for (const imp of sf.getImportDeclarations()) {
        const spec = imp.getModuleSpecifierValue()
        if (pluginRuntimeSpecifier.test(spec)) {
          fail(
            check,
            `Server assembler ${relPath} imports the browser plugin runtime (${spec}); server-side plugin (V2) execution is on the no-port list.`,
            imp,
          )
        }
      }

      for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
        if (id.getText() === 'pluginV2') {
          fail(
            check,
            `Server assembler ${relPath} references the pluginV2 registry; server-side plugin (V2) execution is unsupported (no-port list).`,
            id,
          )
        }
      }

      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (call.getExpression().getText() === 'eval') {
          fail(
            check,
            `Server assembler ${relPath} calls eval(); server-side plugin (V2) execution must not be introduced via a JS eval sandbox.`,
            call,
          )
        }
      }
      for (const expr of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        if (expr.getExpression().getText() === 'Function') {
          fail(
            check,
            `Server assembler ${relPath} constructs new Function(); server-side plugin (V2) execution must not be introduced via a JS eval sandbox.`,
            expr,
          )
        }
      }
    }
  }

  // Positive half: the classifier must still detect pluginV2 and hard-fail it.
  const classifier = source('src/ts/process/request/serverPromptAssembly.ts')
  const importsPluginV2 = classifier
    .getImportDeclarations()
    .some((imp) => imp.getNamedImports().some((named) => named.getName() === 'pluginV2'))
  if (!importsPluginV2) {
    fail(
      check,
      'serverPromptAssembly classifier no longer imports the pluginV2 registry; the permanent-unsupported plugin gate may be gone.',
      undefined,
      classifier,
    )
  }
  const inspectsEditSet = classifier
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .some((access) =>
      /^pluginV2\.(?:editinput|editoutput|editprocess|editdisplay|replacerbeforeRequest|replacerafterRequest)\b/.test(
        access.getText(),
      ),
    )
  if (!inspectsEditSet) {
    fail(
      check,
      'serverPromptAssembly classifier no longer inspects any pluginV2 edit set; pluginV2 sends could route to server assembly instead of hard-failing.',
      undefined,
      classifier,
    )
  }
}

// ----- A4R-group-chat-removed: legacy group chat stays removed from the client -----
//
// Group chat is fully legacy (docs/client-thinning/unsupported-and-client-owned.md):
// the server has no group/member model, so it must neither be ported nor remain a
// usable browser-only durable path. The dead `char.type === 'group'` UI branches in
// the character catalog / chat-list surfaces were removed; three defense layers keep
// a group character unreachable. This invariant is AST-derived (no source-text needle)
// and has two halves:
//
//   negative — the catalog / chat-list UI surfaces (GridCatalog.svelte, ChatList.svelte)
//     must not reintroduce a character `type === 'group'` comparison. Scoped to those two
//     files on purpose: the sidebar accordion (Toggles.svelte / util.ts) legitimately
//     compares an unrelated `toggle.type === 'group'`, so a repo-wide scan would false-
//     positive. Svelte <script> bodies and every markup brace group (attribute handlers
//     and `{#if ...}`-style logic blocks) are parsed as TS and walked for the comparison.
//   positive — the three layers that make a group character unreachable must remain:
//     the load-time filter (setDatabase strips `type === 'group'`), the server prompt-
//     assembly hard-fail (a `type === 'group'` comparison guarding an `unsupported`
//     return), and the request hardcode (`isGroupChat: false`). Deleting any one would
//     re-open a durable group-chat path the server cannot own.

const GROUP_CHAT_UI_PATHS = [
  'src/lib/Others/GridCatalog.svelte',
  'src/lib/Others/ChatList.svelte',
] as const

function isGroupStringLiteral(node: Node): boolean {
  return Node.isStringLiteral(node) && node.getLiteralValue() === 'group'
}

function accessesTypeMember(node: Node): boolean {
  return Node.isPropertyAccessExpression(node) && node.getName() === 'type'
}

// True iff `scope` contains an (in)equality comparing a `.type` member access to the
// string literal 'group' — the shape of every character-type group branch/guard.
function findCharTypeGroupComparison(scope: Node): Node | undefined {
  for (const bin of scope.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = bin.getOperatorToken().getKind()
    if (
      op !== SyntaxKind.EqualsEqualsEqualsToken &&
      op !== SyntaxKind.EqualsEqualsToken &&
      op !== SyntaxKind.ExclamationEqualsEqualsToken &&
      op !== SyntaxKind.ExclamationEqualsToken
    ) {
      continue
    }
    const left = bin.getLeft()
    const right = bin.getRight()
    const hasGroup = isGroupStringLiteral(left) || isGroupStringLiteral(right)
    const hasType = accessesTypeMember(left) || accessesTypeMember(right)
    if (hasGroup && hasType) return bin
  }
  return undefined
}

// Generic `{...}` brace-group extractor: captures both attribute expressions
// (`onclick={() => {...}}`) and svelte logic/mustache blocks (`{#if ...}`, `{expr}`),
// respecting nested braces and strings. Mirrors extractSvelteAttributeExpressions but
// anchors on any `{` rather than only `={`.
function extractSvelteBraceGroups(markup: string): string[] {
  const groups: string[] = []
  let i = 0
  while (i < markup.length) {
    const anchor = markup.indexOf('{', i)
    if (anchor === -1) break
    let depth = 0
    let inString: string | null = null
    let inner = ''
    let j = anchor
    let closed = false
    for (; j < markup.length; j++) {
      const ch = markup[j]
      const prev = j > 0 ? markup[j - 1] : ''
      if (inString) {
        inner += ch
        if (ch === inString && prev !== '\\') inString = null
        continue
      }
      if (ch === '{') {
        depth++
        if (depth > 1) inner += ch
        continue
      }
      if (ch === '}') {
        depth--
        if (depth === 0) {
          closed = true
          break
        }
        inner += ch
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch
        inner += ch
        continue
      }
      inner += ch
    }
    if (closed && inner.trim()) groups.push(inner.trim())
    i = j + 1
  }
  return groups
}

// Parse a svelte file into TS fragments: each <script> body (as statements) plus each
// markup brace group (as an expression, after stripping a leading svelte block keyword).
function svelteTsFragments(rl: string): string[] {
  const svelteText = text(rl)
  const fragments: string[] = []
  const scriptBlockPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  for (const match of svelteText.matchAll(scriptBlockPattern)) fragments.push(match[1])
  const markup = svelteText
    .replace(scriptBlockPattern, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  for (const group of extractSvelteBraceGroups(markup)) {
    const blockMatch = group.match(/^[#:](?:if|else if|each|await|then|catch|key)\b\s*([\s\S]*)$/)
    if (blockMatch) {
      const expr = blockMatch[1].trim()
      if (expr) fragments.push(`;(${expr});`)
      continue
    }
    // Closing tags (`/if`), bare `:else`, and `@`-directives carry no comparison of
    // interest; everything else is a plain mustache expression.
    if (/^[/:@#]/.test(group)) continue
    fragments.push(`;(${group});`)
  }
  return fragments
}

function svelteHasCharTypeGroupComparison(rl: string): boolean {
  const svelteProject = new Project({ useInMemoryFileSystem: true })
  let index = 0
  for (const fragment of svelteTsFragments(rl)) {
    const sf = svelteProject.createSourceFile(`fragment_${index++}.ts`, fragment)
    if (findCharTypeGroupComparison(sf)) return true
  }
  return false
}

function loadOptionalSource(rl: string): SourceFile | undefined {
  const abs = path.join(root, rl)
  return project.getSourceFile(abs) ?? project.addSourceFileAtPathIfExists(abs)
}

// True iff `comparison` is the condition of an `if` whose then-branch returns
// `{ type: 'unsupported', ... }` — i.e. the group send is hard-failed, not assembled.
function comparisonGuardsUnsupportedReturn(comparison: Node): boolean {
  const ifStatement = comparison.getFirstAncestorByKind(SyntaxKind.IfStatement)
  if (!ifStatement) return false
  for (const ret of ifStatement
    .getThenStatement()
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const expr = ret.getExpression()
    if (!expr || !Node.isObjectLiteralExpression(expr)) continue
    const typeProp = expr.getProperty('type')
    if (typeProp && Node.isPropertyAssignment(typeProp)) {
      const init = typeProp.getInitializer()
      if (init && Node.isStringLiteral(init) && init.getLiteralValue() === 'unsupported')
        return true
    }
  }
  return false
}

function hasIsGroupChatFalse(sf: SourceFile): boolean {
  return sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment).some((pa) => {
    if (pa.getName() !== 'isGroupChat') return false
    const init = pa.getInitializer()
    return !!init && init.getKind() === SyntaxKind.FalseKeyword
  })
}

function checkGroupChatRemoved(): void {
  const check = 'A4R-group-chat-removed legacy group chat removed from client'

  // Catalog and chat-list UI surfaces must not compare character type to 'group';
  // missing files are skipped for partial fixtures.
  for (const rl of GROUP_CHAT_UI_PATHS) {
    if (!fs.existsSync(path.join(root, rl))) continue
    if (svelteHasCharTypeGroupComparison(rl)) {
      fail(
        check,
        `${rl} compares a character type to 'group'; group chat is legacy and its client UI branch must stay removed.`,
        undefined,
        rl,
      )
    }
  }

  // Positive half P1: the load-time filter that strips group characters on load.
  const dbFile = loadOptionalSource('src/ts/storage/database.svelte.ts')
  if (!dbFile) {
    fail(
      check,
      'expected src/ts/storage/database.svelte.ts to exist for the load-time group filter.',
    )
  } else {
    const setDatabase = dbFile.getFunction('setDatabase')
    if (!setDatabase) {
      fail(
        check,
        'database.svelte.ts no longer defines setDatabase; the load-time group filter cannot be verified.',
        undefined,
        dbFile,
      )
    } else if (!findCharTypeGroupComparison(setDatabase)) {
      fail(
        check,
        "setDatabase no longer filters characters by type !== 'group'; group characters could load into client state.",
        undefined,
        dbFile,
      )
    }
  }

  // Positive half P2: server prompt assembly still hard-fails a group character.
  const assembly = loadOptionalSource('src/ts/process/request/serverPromptAssembly.ts')
  if (!assembly) {
    fail(
      check,
      'expected src/ts/process/request/serverPromptAssembly.ts to exist for the group hard-fail.',
    )
  } else {
    const comparison = findCharTypeGroupComparison(assembly)
    if (!comparison) {
      fail(
        check,
        'serverPromptAssembly no longer hard-fails a group character; a surviving group send could route to server assembly.',
        undefined,
        assembly,
      )
    } else if (!comparisonGuardsUnsupportedReturn(comparison)) {
      fail(
        check,
        "the group comparison in serverPromptAssembly no longer guards an 'unsupported' return.",
        comparison,
      )
    }
  }

  // Positive half P3: the request boundary keeps isGroupChat hardcoded false.
  const dispatch = loadOptionalSource('src/ts/process/dispatch/dispatchRequest.ts')
  if (!dispatch) {
    fail(
      check,
      'expected src/ts/process/dispatch/dispatchRequest.ts to exist for the isGroupChat hardcode.',
    )
  } else if (!hasIsGroupChatFalse(dispatch)) {
    fail(
      check,
      'dispatchRequest no longer sends isGroupChat: false; the request boundary must keep the group flag hardcoded false.',
      undefined,
      dispatch,
    )
  }
}

function checkDevToolScriptstateCommandBacked(): void {
  const check = 'A4R-devtool scriptstate command-backed'
  const rl = 'src/lib/SideBars/DevTool.svelte'
  const absolute = path.join(root, rl)
  if (!fs.existsSync(absolute)) {
    return
  }

  const body = text(rl)
  if (/bind:value=\{[\s\S]{0,240}?scriptstate\[/.test(body)) {
    fail(
      check,
      'DevTool variable editors bind directly into chat.scriptstate; route edits through the scriptstate command helper.',
      undefined,
      rl,
    )
  }
  if (!body.includes('dispatchPatchChatScriptstate')) {
    fail(
      check,
      'DevTool scriptstate editing must dispatch through dispatchPatchChatScriptstate.',
      undefined,
      rl,
    )
  }
}

function checkDevToolAutopilotCommandBacked(): void {
  const check = 'A4R-devtool autopilot command-backed'
  const rl = 'src/lib/SideBars/DevTool.svelte'
  const absolute = path.join(root, rl)
  if (!fs.existsSync(absolute)) {
    return
  }

  const body = text(rl)
  const start = body.indexOf("<Accordion styled name={'Autopilot'}>")
  if (start === -1) {
    fail(
      check,
      'DevTool Autopilot accordion is missing; command-backed path cannot be verified.',
      undefined,
      rl,
    )
    return
  }
  const end = body.indexOf('</Accordion>', start)
  const section = end === -1 ? body.slice(start) : body.slice(start, end)
  if (!section.includes('appendCurrentChatUserMessageForSend')) {
    fail(
      check,
      'DevTool Autopilot must append user messages through appendCurrentChatUserMessageForSend before sendChat.',
      undefined,
      rl,
    )
  }
  if (/\.message\.push\s*\(/.test(section) || /\bsetDatabase\s*\(/.test(section)) {
    fail(
      check,
      'DevTool Autopilot directly mutates the chat projection; route user-message appends through the command helper.',
      undefined,
      rl,
    )
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

// ----- A4R-provider-capability: one shared provider-routing table -----
//
// Invariant (closeout decision #5): the server provider-routing decision — which
// provider dispatches a model, or that it is unsupported — is single-sourced in
// `resolveProviderCapability` (`src/ts/process/request/providerCapability.ts`).
// The server /chat dispatcher (chatDispatch.ts) must consume it, and server
// completion reaches that same dispatcher through its server-intent route. This
// keeps the old drift bug closed: /chat rejected a reverse_proxy + ooba shape
// the completion path accepted. AST-derived, two halves:
//
//   positive — each consumer that exists must import `resolveProviderCapability`
//     from a `providerCapability` module and actually call it. Dropping either
//     means that path re-forked its own routing decision.
//   negative — the /chat dispatcher must not re-declare the removed capability
//     fork (`resolveProvider` / `unsupportedChatProviderReason`); the decision
//     comes from the shared table, not a local function. (resolveProviderModel /
//     resolveModelInfo and the other dispatch helpers are unrelated — only those
//     two removed deciders are forbidden, by exact name.)
function checkProviderCapabilityShared(): void {
  const check = 'A4R-provider-capability shared routing table'
  const providerCapabilitySpecifier = /(?:^|\/)providerCapability$/
  const consumers = [
    { relPath: 'server/fastify/src/prompt/chatDispatch.ts', label: 'server /chat dispatcher' },
  ]

  for (const { relPath, label } of consumers) {
    const abs = path.join(root, relPath)
    // A fixture may exercise only one consumer; a missing file means there is no
    // routing path here to check, so skip rather than fail.
    if (!fs.existsSync(abs)) continue
    const sf = project.getSourceFile(abs) ?? project.addSourceFileAtPathIfExists(abs)
    if (!sf) continue

    const importsTable = sf
      .getImportDeclarations()
      .some(
        (imp) =>
          providerCapabilitySpecifier.test(imp.getModuleSpecifierValue()) &&
          imp.getNamedImports().some((named) => named.getName() === 'resolveProviderCapability'),
      )
    if (!importsTable) {
      fail(
        check,
        `${label} (${relPath}) no longer imports resolveProviderCapability from the shared providerCapability table; the provider-routing decision must not re-fork.`,
        undefined,
        sf,
      )
      continue
    }

    const callsTable = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => call.getExpression().getText() === 'resolveProviderCapability')
    if (!callsTable) {
      fail(
        check,
        `${label} (${relPath}) imports but never calls resolveProviderCapability; the shared table must own the routing decision.`,
        undefined,
        sf,
      )
    }
  }

  // Negative half: the /chat dispatcher must not resurrect its own capability fork.
  const chatAbs = path.join(root, 'server/fastify/src/prompt/chatDispatch.ts')
  if (fs.existsSync(chatAbs)) {
    const chat = project.getSourceFile(chatAbs) ?? project.addSourceFileAtPathIfExists(chatAbs)
    if (chat) {
      for (const fn of chat.getFunctions()) {
        const name = fn.getName()
        if (name === 'resolveProvider' || name === 'unsupportedChatProviderReason') {
          fail(
            check,
            `server /chat dispatcher re-declares ${name}(); the provider-routing decision must come from the shared resolveProviderCapability table, not a local fork.`,
            fn,
          )
        }
      }
    }
  }
}

// ----- A4R-server-completion-intent: browser does not build provider wire -----
//
// Server-owned completion dispatch means the browser may send prompt/control
// intent to `/generate/completion`, but must not derive provider options,
// endpoint URLs, or API-key/credential-bearing payload fields.
function checkBrowserCompletionIntentPayload(): void {
  const check = 'A4R-server-completion-intent browser payload'
  const relPath = 'src/ts/process/request/serverCompletion.ts'
  const abs = path.join(root, relPath)
  if (!fs.existsSync(abs)) return
  const sf = project.getSourceFile(abs) ?? project.addSourceFileAtPathIfExists(abs)
  if (!sf) return

  for (const imp of sf.getImportDeclarations()) {
    const namedImports = imp.getNamedImports().map((named) => named.getName())
    for (const name of namedImports) {
      if (name === 'getDatabase' || name === 'resolveProviderCapability') {
        fail(
          check,
          `${relPath} imports ${name}; browser completion must not resolve provider policy for server dispatch.`,
          imp,
        )
      }
    }
  }

  const requestFn = sf.getFunction('requestServerCompletion')
  if (!requestFn) {
    fail(check, `${relPath} no longer exports requestServerCompletion`, undefined, sf)
  } else if (requestFn.getParameters().length !== 2) {
    fail(
      check,
      'requestServerCompletion must accept only the completion target and abort signal; a provider/options parameter would reintroduce client-built provider wire.',
      requestFn,
    )
  }

  const text = sf.getFullText()
  for (const forbidden of [
    'buildProviderOptions',
    'resolveProviderModel',
    'apiKey',
    'baseUrl',
    'credentials',
    'provider:',
    'options:',
  ]) {
    if (text.includes(forbidden)) {
      fail(
        check,
        `${relPath} contains "${forbidden}"; server completion payloads must stay provider-wire-free.`,
        undefined,
        sf,
      )
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
  { id: 'A4R-pluginv2 no server-side plugin execution', run: checkPluginV2NoServerExecution },
  { id: 'A4R-devtool scriptstate command-backed', run: checkDevToolScriptstateCommandBacked },
  { id: 'A4R-devtool autopilot command-backed', run: checkDevToolAutopilotCommandBacked },
  {
    id: 'A4R-group-chat-removed legacy group chat removed from client',
    run: checkGroupChatRemoved,
  },
  { id: 'A4R-provider-capability shared routing table', run: checkProviderCapabilityShared },
  { id: 'A4R-server-completion-intent browser payload', run: checkBrowserCompletionIntentPayload },
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
