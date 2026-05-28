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
  const initializer = declaration?.getInitializer()
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
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return
      const firstArg = node.getArguments()[0]
      const route = firstArg?.asKind(SyntaxKind.StringLiteral)?.getLiteralText()
      if (!route) return
      const pos = file.getLineAndColumnAtPos(node.getStart())
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

function isKnownServerOwnedMutation(method: string, route: string): boolean {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return false
  if (route.startsWith('/api/v1/commands/')) return true
  if (method === 'POST' && route === '/api/v1/import/risusave') return true
  if (method === 'POST' && route === '/api/v1/assets') return true
  if (route.startsWith('/api/v1/backups')) return true
  return method === 'POST' && ['/api/v1/storage/write', '/api/v1/storage/remove'].includes(route)
}

function checkActiveWriterGuard(): void {
  const check = 'EC5 active-writer guard'
  const appText = text('server/fastify/src/app.ts')
  const bootstrapIndex = appText.indexOf('registerBootstrapRoutes(')
  const guardIndex = appText.indexOf('registerActiveWriterGuard(app, activeWriterState)')
  const firstMutationIndex = Math.min(
    ...[
      'registerSaveRoutes(',
      'registerCommandRoutes(',
      'registerAssetsRoutes(',
      'registerBackupRoutes(',
      'registerLegacyStorageRoutes(',
    ].map((needle) => appText.indexOf(needle)),
  )
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
  const expectedClassifierNeedles = [
    "'/api/v1/commands/'",
    "'/api/v1/import/risusave'",
    "'/api/v1/assets'",
    "'/api/v1/backups'",
    "'/api/v1/storage/write'",
    "'/api/v1/storage/remove'",
  ]
  for (const needle of expectedClassifierNeedles) {
    if (!activeWriterText.includes(needle)) {
      fail(
        check,
        `active-writer classifier is missing ${needle}.`,
        undefined,
        'server/fastify/src/activeWriter.ts',
      )
    }
  }

  const routeFiles = project
    .getSourceFiles()
    .filter((file) => rel(file).startsWith('server/fastify/src/routes/'))
  const mutations = routeRegistrations(routeFiles).filter((route) =>
    isKnownServerOwnedMutation(route.method, route.route),
  )
  if (mutations.length === 0) {
    fail(check, 'No server-owned mutating routes were discovered; audit route extraction is stale.')
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

function checkAssetWalkerValidators(): void {
  const check = 'EC6 asset walker validator drift'
  const walkerText = text('server/fastify/src/risuSave/assetReferences.ts')
  const characterText = text('server/fastify/src/commands/characters.ts')
  const presetText = text('server/fastify/src/commands/presets.ts')
  const requiredCharacterValidators = [
    ['record.image', "'image' in record"],
    ['record.emotionImages', "'emotionImages' in record"],
    ['record.additionalAssets', "'additionalAssets' in record"],
    ['record.ccAssets', "'ccAssets' in record"],
    ['record.prebuiltAssetExclude', "'prebuiltAssetExclude' in record"],
    ['record.vits', "'vits' in record"],
    ['record.gptSoVitsConfig', "'gptSoVitsConfig' in record"],
  ]
  for (const [walkerNeedle, validatorNeedle] of requiredCharacterValidators) {
    if (walkerText.includes(walkerNeedle) && !characterText.includes(validatorNeedle)) {
      fail(
        check,
        `Asset walker reads ${walkerNeedle}, but character command validation lacks ${validatorNeedle}.`,
        undefined,
        'server/fastify/src/commands/characters.ts',
      )
    }
  }

  const orderValidators = [
    ['record.img, `database.characterOrder', '.img`'],
    ['record.imgFile, `database.characterOrder', '.imgFile`'],
  ]
  for (const [walkerNeedle, validatorNeedle] of orderValidators) {
    if (walkerText.includes(walkerNeedle) && !characterText.includes(validatorNeedle)) {
      fail(
        check,
        `Asset walker reads characterOrder${validatorNeedle.slice(0, -1)}, but character-order command validation does not validate it.`,
        undefined,
        'server/fastify/src/commands/characters.ts',
      )
    }
  }

  const presetValidators = [['record.image, `database.botPresets', "'image' in record"]]
  for (const [walkerNeedle, validatorNeedle] of presetValidators) {
    if (walkerText.includes(walkerNeedle) && !presetText.includes(validatorNeedle)) {
      fail(
        check,
        'Asset walker reads botPresets[*].image, but preset command validation does not validate it.',
        undefined,
        'server/fastify/src/commands/presets.ts',
      )
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
