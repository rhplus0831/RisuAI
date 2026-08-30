import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { MODULE_ACTIVATION_SOURCES } from '@risuai/shared-core/module-activation'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const PLUGIN_V3_DIRECT_API_CLASSIFICATION = {
  compatibility_network_provider: [
    'risuFetch',
    'nativeFetch',
    'getChar',
    'setChar',
    'addProvider',
    'runLLMModel',
    'sendChat',
    'saveSecretHeader',
  ],
  hooks_and_transforms: [
    'addTTSPreprocessor',
    'addTTSPostprocessor',
    'addRisuScriptHandler',
    'removeRisuScriptHandler',
    'addRisuReplacer',
    'removeRisuReplacer',
    'addRisuChatListener',
    'removeRisuChatListener',
    'registerBodyIntercepter',
    'unregisterBodyIntercepter',
  ],
  database_storage_and_theme: [
    'setDatabaseLite',
    'setDatabase',
    'getDatabase',
    'installPlugin',
    'getArg',
    'setArg',
    'getArgument',
    'setArgument',
    'getLocalPluginStorage',
    'changeColorScheme',
    'setColorScheme',
    'getColorScheme',
    'changeTextTheme',
    'setCustomTextTheme',
    'getTextTheme',
  ],
  character_and_chat: [
    'getCharacterFromIndex',
    'setCharacterToIndex',
    'getChatFromIndex',
    'setChatToIndex',
    'getCurrentCharacterIndex',
    'getCurrentChatIndex',
    'getCurrentLorebookEntries',
    'getCharacter',
    'setCharacter',
    'checkCharOrder',
  ],
  ui_and_sandbox: [
    'showContainer',
    'hideContainer',
    'getRootDocument',
    'registerSetting',
    'registerButton',
    'setChatPanel',
    'unregisterUIPart',
    'createMutationObserver',
  ],
  extension_assets_and_lifecycle: [
    'loadPlugins',
    'readImage',
    'readInlay',
    'saveAsset',
    'registerMCP',
    'unregisterMCP',
    'onUnload',
    'getFetchLogs',
    'getRuntimeInfo',
    'requestPluginPermission',
    'searchTranslationCache',
    'getTranslationCache',
    'addPluginChannelListener',
    'postPluginChannelMessage',
    'log',
    'alert',
    'alertConfirm',
    'alertError',
  ],
  sandbox_internal_bridge: [
    '_getOldKeys',
    '_getPropertiesForInitialization',
    '_getPluginStorage',
    '_setPluginStorage',
    '_removePluginStorage',
    '_clearPluginStorage',
    '_keyPluginStorage',
    '_keysPluginStorage',
    '_lengthPluginStorage',
    '_getSafeLocalStorage',
    '_setSafeLocalStorage',
    '_removeSafeLocalStorage',
    '_clearSafeLocalStorage',
    '_keySafeLocalStorage',
    '_keysSafeLocalStorage',
    '_getAliases',
  ],
} as const

const PLUGIN_PERMISSIONS = [
  'fetchLogs',
  'db',
  'mainDom',
  'network',
  'pluginUpdate',
  'replacer',
  'provider',
  'sendChat',
  'v3Runtime',
] as const

const PLUGIN_RPC_MESSAGE_TYPES = [
  'CALL_ROOT',
  'CALL_INSTANCE',
  'INVOKE_CALLBACK',
  'CALLBACK_RETURN',
  'RESPONSE',
  'RELEASE_INSTANCE',
  'ABORT_SIGNAL',
] as const

const MODULE_LIFECYCLE_OWNER_ANCHORS = {
  'src/ts/process/modules.ts': [
    "selectSingleFile(['json', 'lorebook', 'risum'])",
    "downloadFile(module.name + '.risum'",
    'createImportedGlobalModule',
    'resolveModuleActivationStates',
  ],
  'src/ts/moduleCommands.ts': [
    'createGlobalModule',
    'updateGlobalModule',
    'deleteGlobalModule',
    'setGlobalModuleEnabled',
    'dispatchReorderModules',
    'toggleSelectedCharacterModule',
  ],
  'server/fastify/src/commands/modules.ts': [
    'createModuleRecord',
    'readModulePatch',
    'removeModuleReferences',
    'isImportableMCPIdentifier',
  ],
  'server/fastify/src/routes/commands.ts': [
    "'/api/v1/commands/modules'",
    "'/api/v1/commands/modules/:moduleId'",
    "'/api/v1/commands/modules/enable'",
    "'/api/v1/commands/modules/reorder'",
  ],
  'server/fastify/src/repository.ts': ["modules: 'modules'", 'writeCollectionTableRows(db, tableName'],
} as const

const MCP_IDENTIFIER_OWNERS = {
  internal: ["mcp.startsWith('internal:')", "case 'internal:risuai'"],
  plugin: ["mcp.startsWith('plugin:')", 'registeredCustomPluginMCPs.get(mcp)'],
  stdio_url_wrapper: ["mcp.startsWith('stdio:')", 'Command-based stdio MCPs are not supported'],
  remote_http: ["mcpUrl.startsWith('https://')", "mcpUrl.startsWith('http://')"],
} as const

const INTERNAL_MCP_CLIENTS = [
  'internal:fs',
  'internal:risuai',
  'internal:aiaccess',
  'internal:googlesearch',
  'internal:graphmem',
  'internal:dice',
] as const

const SPECIALIZED_TOOL_CATALOG = {
  'src/ts/process/mcp/filesystemclient.ts': [
    'fs_read_file',
    'fs_write_file',
    'fs_list_directory',
    'fs_create_directory',
    'fs_delete_file',
    'fs_search_files',
    'fs_copy_file',
    'fs_move_file',
    'fs_get_file_info',
    'fs_find_duplicates',
    'fs_tree_view',
  ],
  'src/ts/process/mcp/aiaccess.ts': ['runLLM'],
  'src/ts/process/mcp/googlesearchclient.ts': ['google_search', 'google_search_images'],
  'src/ts/process/mcp/graphmem.ts': ['writeMemory', 'readMemory'],
  'src/ts/process/mcp/dice.ts': ['rollDice'],
  'src/ts/process/mcp/risuaccess/characters.ts': [
    'risu-get-character-info',
    'risu-list-character-lorebooks',
    'risu-get-character-lorebook',
    'risu-set-character-info',
    'risu-set-character-lorebook',
    'risu-delete-character-lorebook',
    'risu-get-character-regex-scripts',
    'risu-set-character-regex-scripts',
    'risu-delete-character-regex-scripts',
    'risu-get-character-additional-assets',
    'risu-get-character-lua-script',
    'risu-set-character-lua-script',
    'risu-delete-character-additional-assets',
    'risu-list-characters',
  ],
  'src/ts/process/mcp/risuaccess/chats.ts': ['risu-get-chat-history'],
  'src/ts/process/mcp/risuaccess/modules.ts': [
    'risu-list-modules',
    'risu-get-module-info',
    'risu-set-module-info',
    'risu-list-module-lorebooks',
    'risu-get-module-lorebook',
    'risu-set-module-lorebook',
    'risu-delete-module-lorebook',
    'risu-get-module-regex-scripts',
    'risu-set-module-regex-script',
    'risu-delete-module-regex-script',
    'risu-get-module-lua-script',
    'risu-set-module-lua-script',
  ],
} as const

describe('Phase 10 compatibility structure', () => {
  it('closes the Plugin V3 API, runtime, permission, RPC, and sandbox vocabularies', () => {
    const pluginSource = readRepoFile('src/ts/plugins/plugins.svelte.ts')
    const v3Source = readRepoFile('src/ts/plugins/apiV3/v3.svelte.ts')
    const permissionSource = readRepoFile('src/ts/plugins/pluginPermissions.ts')
    const factorySource = readRepoFile('src/ts/plugins/apiV3/factory.ts')
    const commandSource = readRepoFile('server/fastify/src/commands/plugins.ts')

    expect(typeAliasStringUnion(pluginSource, 'PluginRuntimePhase').sort()).toEqual(
      ['idle', 'loading', 'ready', 'error'].sort(),
    )
    expect(typeAliasStringUnion(permissionSource, 'PluginPermission').sort()).toEqual([...PLUGIN_PERMISSIONS].sort())
    expect(typeAliasStringUnion(factorySource, 'MsgType').sort()).toEqual([...PLUGIN_RPC_MESSAGE_TYPES].sort())

    const classifiedApiKeys = Object.values(PLUGIN_V3_DIRECT_API_CLASSIFICATION).flat()
    expect(new Set(classifiedApiKeys).size).toBe(classifiedApiKeys.length)
    expect(variableObjectLiteralPropertyNames(v3Source, 'api').sort()).toEqual([...classifiedApiKeys].sort())

    expect(pluginSource).toContain("if (apiVersion !== '3.0')")
    expect(commandSource).toContain("if (value !== '3.0')")
    expect(factorySource).toContain("connect-src 'none'")
    expect(factorySource).toContain("frame-src 'none'")
    expect(factorySource).toContain("child-src 'none'")
  })

  it('closes module activation, lifecycle, MCP restrictions, and the signed interchangeability no-port', () => {
    expect([...MODULE_ACTIVATION_SOURCES]).toEqual([
      'global',
      'chat',
      'character',
      'persona',
      'promptPresetIntegration',
      'agentPresetIntegration',
      'legacyIntegration',
    ])
    for (const [sourcePath, anchors] of Object.entries(MODULE_LIFECYCLE_OWNER_ANCHORS)) {
      const source = readRepoFile(sourcePath)
      for (const anchor of anchors) expect(source, `${sourcePath}: ${anchor}`).toContain(anchor)
    }

    const moduleSource = readRepoFile('src/ts/process/modules.ts')
    const moduleSettingsSource = readRepoFile('src/lib/Setting/Pages/Module/ModuleSettings.svelte')
    const characterSettingsSource = readRepoFile('src/lib/SideBars/CharConfig.svelte')
    expect(existsSync(path.join(REPO_ROOT, 'src/ts/interchangeability.ts'))).toBe(false)
    for (const source of [moduleSource, moduleSettingsSource, characterSettingsSource]) {
      expect(source).not.toContain('convertModuleToCharacter')
      expect(source).not.toContain('convertCharacterToModule')
    }
    expect(moduleSource).not.toContain("'charx'")
    expect(moduleSettingsSource).not.toContain('convertToModule')
    expect(characterSettingsSource).not.toContain('convertToModule')
  })

  it('closes MCP identifier, client, registry, OAuth, and egress ownership', () => {
    const mcpSource = readRepoFile('src/ts/process/mcp/mcp.ts')
    for (const [identifierClass, anchors] of Object.entries(MCP_IDENTIFIER_OWNERS)) {
      for (const anchor of anchors) expect(mcpSource, `${identifierClass}: ${anchor}`).toContain(anchor)
    }
    expect(
      stringCaseLabels(mcpSource)
        .filter((value) => value.startsWith('internal:'))
        .sort(),
    ).toEqual([...INTERNAL_MCP_CLIENTS].sort())
    expect(mcpSource).toContain("const callOnlyMCPUrls = ['internal:risuai']")
    expect(mcpSource).toContain('if (!index.has(tool.name))')

    const importPredicate = readRepoFile('packages/shared-core/src/mcpIdentifier.ts')
    expect(importPredicate).toContain('/^(internal|stdio|plugin):\\S+$/')
    expect(importPredicate).toContain("url.protocol === 'https:'")
    expect(importPredicate).toContain("url.hostname === 'localhost'")

    expect(readRepoFile('src/ts/server/mcpOAuthRefresh.ts')).toContain('requestStoredMcpOAuthRefresh')
    expect(readRepoFile('server/fastify/src/routes/mcpOAuthRefresh.ts')).toContain('executeStoredMcpOAuthRefresh')
    const egressSource = readRepoFile('server/fastify/src/mcpOAuthRefreshEgress.ts')
    expect(egressSource).toContain('resolveMcpOAuthRefreshAddresses')
    expect(egressSource).toContain('dnsLookup(host, { all: true })')
    expect(egressSource).toContain('lookup: pinnedLookup')
  })

  it('classifies every advertised specialized and Risu-access tool', () => {
    for (const [sourcePath, expectedTools] of Object.entries(SPECIALIZED_TOOL_CATALOG)) {
      expect(advertisedToolNames(readRepoFile(sourcePath)), sourcePath).toEqual(expectedTools)
    }

    const authorityAnchors = {
      'src/ts/process/mcp/filesystemclient.ts': ['showDirectoryPicker', 'requestPermission', 'throwIfAborted'],
      'src/ts/process/mcp/aiaccess.ts': ['requestChatData', "model === 'lite' ? 'scriptAux' : 'scriptMain'"],
      'src/ts/process/mcp/googlesearchclient.ts': [
        'Google Search MCP credentials are not supported in server-backed web mode',
      ],
      'src/ts/process/mcp/graphmem.ts': ["setChatVar('graphmem_graph'", 'GRAPH_MEMORY_MAX_SEARCH_DEPTH'],
      'src/ts/process/mcp/dice.ts': ['DICE_MAX_COUNT', 'DICE_MAX_SIDES'],
      'src/ts/process/mcp/risuaccess/client.ts': ['Tool call aborted.', 'new CharacterHandler(abortSignal)'],
      'src/ts/process/mcp/risuaccess/characters.ts': ['promptAccess', 'dispatchUpdateCharacterScoped'],
      'src/ts/process/mcp/risuaccess/modules.ts': ['promptAccess', 'dispatchModuleInfoPatch'],
    } as const
    for (const [sourcePath, anchors] of Object.entries(authorityAnchors)) {
      const source = readRepoFile(sourcePath)
      for (const anchor of anchors) expect(source, `${sourcePath}: ${anchor}`).toContain(anchor)
    }
  })
})

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function typeAliasStringUnion(source: string, typeName: string): string[] {
  const parsed = parseSource(source)
  const declaration = parsed.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName,
  )
  expect(declaration, typeName).toBeDefined()
  const members = ts.isUnionTypeNode(declaration!.type) ? declaration!.type.types : [declaration!.type]
  return members.map((member) => {
    expect(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal), member.getText()).toBe(true)
    return (member as ts.LiteralTypeNode & { literal: ts.StringLiteral }).literal.text
  })
}

function variableObjectLiteralPropertyNames(source: string, variableName: string): string[] {
  const parsed = parseSource(source)
  let target: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      target = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  expect(target, variableName).toBeDefined()
  return target!.properties.map((property) => {
    expect(!ts.isSpreadAssignment(property), property.getText(parsed)).toBe(true)
    const name = (property as ts.ObjectLiteralElementLike & { name?: ts.PropertyName }).name
    expect(name && (ts.isIdentifier(name) || ts.isStringLiteral(name)), property.getText(parsed)).toBeTruthy()
    return (name as ts.Identifier | ts.StringLiteral).text
  })
}

function stringCaseLabels(source: string): string[] {
  const labels: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) labels.push(node.expression.text)
    ts.forEachChild(node, visit)
  }
  visit(parseSource(source))
  return labels
}

function advertisedToolNames(source: string): string[] {
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      let name: string | undefined
      let hasInputSchema = false
      for (const property of node.properties) {
        if (!('name' in property) || !property.name) continue
        const propertyName =
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
        if (propertyName === 'inputSchema') hasInputSchema = true
        if (propertyName === 'name' && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) {
          name = property.initializer.text
        }
      }
      if (name && hasInputSchema) names.push(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(source))
  return names
}
