import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { serverUnsupportedTriggerEffectTypes } from '../src/prompt/triggerCompatibility.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

type LuaApiClass = 'supported' | 'browser-ui-noop' | 'interactive-rejected' | 'media-read-rejected'

/** A new script-visible host API must choose its Fastify disposition here. */
const LUA_API_CLASSIFICATION: Record<string, LuaApiClass> = classifyLuaApis({
  supported: [
    'LLMMain',
    'addChat',
    'axLLMMain',
    'cbs',
    'cutChat',
    'generateImage',
    'getAuthorsNote',
    'getBackgroundEmbedding',
    'getCharacterFirstMessage',
    'getCharacterLastMessage',
    'getChatData',
    'getChatLength',
    'getChatMain',
    'getChatRole',
    'getChatVar',
    'getDescription',
    'getFullChatMain',
    'getGlobalVar',
    'getLoreBooksMain',
    'getName',
    'getPersonaDescription',
    'getPersonaName',
    'getRecentChatsMain',
    'getTokens',
    'getUserLastMessage',
    'hash',
    'insertChat',
    'loadLoreBooksMain',
    'logMain',
    'removeChat',
    'request',
    'setBackgroundEmbedding',
    'setCharacterFirstMessage',
    'setChat',
    'setChatRole',
    'setChatVar',
    'setChatVarChanged',
    'setDescription',
    'setFullChatMain',
    'setName',
    'similarity',
    'simpleLLM',
    'sleep',
    'stopChat',
    'upsertLocalLoreBook',
  ],
  'browser-ui-noop': ['alertError', 'alertNormal', 'reloadChat', 'reloadDisplay'],
  'interactive-rejected': ['alertConfirm', 'alertInput', 'alertSelect'],
  'media-read-rejected': ['getCharacterImageMain', 'getPersonaImageMain'],
})

describe('Phase 9 scripting, parsing, trigger, and automation structure', () => {
  it('keeps every canonical CBS matcher and alias owned by one registration', () => {
    const registrations = cbsRegistrations(sourceFile('src/ts/cbs.ts'))
    const owners = new Map<string, string>()

    for (const registration of registrations) {
      for (const matcher of [registration.name, ...registration.aliases]) {
        const normalized = normalizeMatcherName(matcher)
        const previousOwner = owners.get(normalized)
        expect(previousOwner === undefined || previousOwner === registration.name).toBe(true)
        owners.set(normalized, registration.name)
      }
    }

    expect(registrations).toHaveLength(176)
    expect(registrations.filter((registration) => registration.executable)).toHaveLength(151)
    expect(owners.size).toBe(245)
  })

  it('classifies every trigger effect as implemented or explicitly unsupported', () => {
    const triggerSource = sourceFile('src/ts/process/triggers.ts')
    const effectTypes = stringDiscriminants(triggerSource, 'triggerEffect', 'type')
    const dataEffectSource = sourceFile('server/fastify/src/prompt/triggerDataEffects.ts')
    const handled = new Set([
      ...switchCaseStrings(sourceFile('server/fastify/src/prompt/triggers.ts'), 'effect.type'),
      ...switchCaseStrings(dataEffectSource, 'effect.type'),
      ...equalityLiteralStrings(dataEffectSource, 'effect.type'),
    ])
    const unsupported = new Set([...serverUnsupportedTriggerEffectTypes].filter((type) => type !== '@@emo'))

    expect(effectTypes).toHaveLength(118)
    expect([...handled].filter((type) => unsupported.has(type))).toEqual([])
    expect([...new Set([...handled, ...unsupported])].sort()).toEqual(effectTypes)
    expect(serverUnsupportedTriggerEffectTypes.has('@@emo')).toBe(true)
  })

  it('keeps the trigger modes, condition kinds, and regex stages closed across adapters', () => {
    const triggerSource = sourceFile('src/ts/process/triggers.ts')
    expect(typeAliasStringUnion(triggerSource, 'triggerMode')).toEqual([
      'display',
      'input',
      'manual',
      'output',
      'request',
      'start',
    ])
    expect(stringDiscriminants(triggerSource, 'triggerCondition', 'type')).toEqual([
      'chatindex',
      'exists',
      'value',
      'var',
    ])

    const browserModes = typeAliasStringUnion(sourceFile('src/ts/process/scripts.ts'), 'ScriptMode')
    const serverModes = typeAliasStringUnion(sourceFile('server/fastify/src/prompt/scripts.ts'), 'ScriptMode')
    expect(browserModes).toEqual(['editdisplay', 'editinput', 'editoutput', 'editprocess'])
    expect(serverModes).toEqual(browserModes)
  })

  it('keeps browser and Fastify Lua host declarations identical and exhaustively classified', () => {
    const browserApis = callFirstArgumentStrings(sourceFile('src/ts/process/scriptings.ts'), 'declareAPI')
    const serverApis = callFirstArgumentStrings(sourceFile('server/fastify/src/prompt/luaRuntime.ts'), 'declare')
    const classifiedApis = Object.keys(LUA_API_CLASSIFICATION).sort()

    expect(browserApis).toHaveLength(54)
    expect(serverApis).toEqual(browserApis)
    expect(classifiedApis).toEqual(browserApis)
  })
})

function classifyLuaApis(groups: Record<LuaApiClass, readonly string[]>): Record<string, LuaApiClass> {
  const entries = Object.entries(groups).flatMap(([classification, names]) =>
    names.map((name) => [name, classification as LuaApiClass] as const),
  )
  if (new Set(entries.map(([name]) => name)).size !== entries.length) {
    throw new Error('Lua API classification contains a duplicate name')
  }
  return Object.fromEntries(entries)
}

function cbsRegistrations(source: ts.SourceFile): Array<{ name: string; aliases: string[]; executable: boolean }> {
  const registrations: Array<{ name: string; aliases: string[]; executable: boolean }> = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'registerFunction' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const object = node.arguments[0]
      const nameProperty = object.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText(source) === 'name',
      )
      if (!nameProperty || !ts.isStringLiteral(nameProperty.initializer)) {
        throw new Error('CBS registration has no static name')
      }
      const name = nameProperty.initializer.text
      const aliasProperty = object.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText(source) === 'alias',
      )
      const aliases =
        aliasProperty && ts.isArrayLiteralExpression(aliasProperty.initializer)
          ? aliasProperty.initializer.elements.map((element) => {
              if (!ts.isStringLiteral(element)) throw new Error(`CBS alias for ${name} is dynamic`)
              return element.text
            })
          : []
      registrations.push({
        name,
        aliases,
        executable: object.properties.some((property) => {
          if (
            (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) ||
            property.name.getText(source) !== 'callback'
          ) {
            return false
          }
          return !(
            ts.isPropertyAssignment(property) &&
            ts.isStringLiteral(property.initializer) &&
            property.initializer.text === 'doc_only'
          )
        }),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return registrations
}

function normalizeMatcherName(value: string): string {
  return value.replaceAll(/[-_\s]/g, '').replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase())
}

function sourceFile(relativePath: string): ts.SourceFile {
  const absolutePath = path.join(REPO_ROOT, relativePath)
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
}

function declarationsByName(source: ts.SourceFile): Map<string, ts.TypeNode | ts.InterfaceDeclaration> {
  const declarations = new Map<string, ts.TypeNode | ts.InterfaceDeclaration>()
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) declarations.set(statement.name.text, statement.type)
    if (ts.isInterfaceDeclaration(statement)) declarations.set(statement.name.text, statement)
  }
  return declarations
}

function typeAliasStringUnion(source: ts.SourceFile, aliasName: string): string[] {
  const declarations = declarationsByName(source)
  const root = declarations.get(aliasName)
  if (!root || ts.isInterfaceDeclaration(root)) throw new Error(`type alias ${aliasName} not found`)
  return [...collectStringLiterals(root, declarations, new Set())].sort()
}

function stringDiscriminants(source: ts.SourceFile, aliasName: string, propertyName: string): string[] {
  const declarations = declarationsByName(source)
  const root = declarations.get(aliasName)
  if (!root || ts.isInterfaceDeclaration(root)) throw new Error(`type alias ${aliasName} not found`)
  return [...collectDiscriminants(root, propertyName, declarations, new Set())].sort()
}

function collectDiscriminants(
  node: ts.TypeNode | ts.InterfaceDeclaration,
  propertyName: string,
  declarations: Map<string, ts.TypeNode | ts.InterfaceDeclaration>,
  visiting: Set<string>,
): Set<string> {
  const values = new Set<string>()
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const member of node.types) addAll(values, collectDiscriminants(member, propertyName, declarations, visiting))
    return values
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return collectDiscriminants(node.type, propertyName, declarations, visiting)
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText()
    if (visiting.has(name)) return values
    const target = declarations.get(name)
    if (!target) return values
    const nextVisiting = new Set(visiting).add(name)
    return collectDiscriminants(target, propertyName, declarations, nextVisiting)
  }

  const members = ts.isInterfaceDeclaration(node) ? node.members : ts.isTypeLiteralNode(node) ? node.members : []
  for (const member of members) {
    if (
      !ts.isPropertySignature(member) ||
      member.name.getText(sourceTextOwner(member)) !== propertyName ||
      !member.type
    ) {
      continue
    }
    addAll(values, collectStringLiterals(member.type, declarations, visiting))
  }
  return values
}

function sourceTextOwner(node: ts.Node): ts.SourceFile {
  return node.getSourceFile()
}

function collectStringLiterals(
  node: ts.TypeNode,
  declarations: Map<string, ts.TypeNode | ts.InterfaceDeclaration>,
  visiting: Set<string>,
): Set<string> {
  const values = new Set<string>()
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    values.add(node.literal.text)
  } else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const member of node.types) addAll(values, collectStringLiterals(member, declarations, visiting))
  } else if (ts.isParenthesizedTypeNode(node)) {
    addAll(values, collectStringLiterals(node.type, declarations, visiting))
  } else if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText()
    if (!visiting.has(name)) {
      const target = declarations.get(name)
      if (target && !ts.isInterfaceDeclaration(target)) {
        addAll(values, collectStringLiterals(target, declarations, new Set(visiting).add(name)))
      }
    }
  }
  return values
}

function switchCaseStrings(source: ts.SourceFile, expressionText: string): string[] {
  const values = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node) && node.expression.getText(source) === expressionText) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) values.add(clause.expression.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...values].sort()
}

function callFirstArgumentStrings(source: ts.SourceFile, functionName: string): string[] {
  const values = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === functionName &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      values.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...values].sort()
}

function equalityLiteralStrings(source: ts.SourceFile, expressionText: string): string[] {
  const values = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      if (node.left.getText(source) === expressionText && ts.isStringLiteral(node.right)) values.add(node.right.text)
      if (node.right.getText(source) === expressionText && ts.isStringLiteral(node.left)) values.add(node.left.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...values].sort()
}

function addAll<T>(target: Set<T>, source: Iterable<T>): void {
  for (const value of source) target.add(value)
}
