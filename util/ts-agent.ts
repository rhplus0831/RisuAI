import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as ts from 'typescript'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const tsserverPath = require.resolve('typescript/lib/tsserver.js')
const defaultTimeoutMs = parsePositiveInteger(process.env.RISU_TS_AGENT_TIMEOUT_MS, 30_000)
const sourceFileCache = new Map<string, ts.SourceFile>()

type JsonObject = Record<string, unknown>

type GlobalOptions = {
  absolute: boolean
  compact: boolean
  project?: string
  timeoutMs: number
}

type ParsedLocation = {
  file: string
  line: number
  character: number
}

type ProtocolResponse = {
  type: 'response'
  request_seq: number
  command: string
  success: boolean
  message?: string
  body?: unknown
}

type ProtocolMessage =
  | ProtocolResponse
  | {
      type: 'event'
      event: string
      body?: unknown
    }

type PendingRequest = {
  command: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

type ProtocolLocation = {
  line: number
  offset: number
}

type ProtocolTextSpan = {
  start: number
  length: number
}

type OutputRange = {
  line: number
  character: number
  endLine: number
  endCharacter: number
}

type TextEdit = {
  file: string
  absoluteFile: string
  start: number
  end: number
  line: number
  character: number
  endLine: number
  endCharacter: number
  oldText: string
  newText: string
}

class TsServerClient {
  private buffer = Buffer.alloc(0)
  private readonly child: ChildProcessWithoutNullStreams
  private readonly openedFiles = new Set<string>()
  private readonly pending = new Map<number, PendingRequest>()
  private seq = 0
  private exited = false

  constructor(private readonly timeoutMs: number) {
    const args = [tsserverPath, '--disableAutomaticTypingAcquisition']
    const logPath = resolveTsserverLogPath()

    if (logPath) {
      args.push('--logVerbosity', 'verbose', '--logFile', logPath)
    }

    this.child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        TSS_LOG: process.env.TSS_LOG ?? '-level off',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => {
      if (process.env.RISU_TS_AGENT_DEBUG) {
        process.stderr.write(chunk)
      }
    })
    this.child.once('exit', (code, signal) => {
      this.exited = true
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
      const error = new Error(`tsserver exited before responding (${reason})`)

      for (const [seq, pending] of this.pending) {
        clearTimeout(pending.timeout)
        pending.reject(error)
        this.pending.delete(seq)
      }
    })

    this.notify('configure', {
      hostInfo: 'risuai-agent-ts',
      preferences: {
        includePackageJsonAutoImports: 'off',
        includeCompletionsForModuleExports: false,
      },
    })
  }

  async openFile(file: string): Promise<void> {
    if (this.openedFiles.has(file)) return

    this.openedFiles.add(file)
    this.notify('open', {
      file,
      projectRootPath: repoRoot,
    })

    await this.request('projectInfo', {
      file,
      needFileNameList: false,
    })
  }

  notify(command: string, args?: JsonObject): number {
    const seq = this.nextSeq()
    this.writeMessage({
      seq,
      type: 'request',
      command,
      arguments: args,
    })
    return seq
  }

  request<T = unknown>(command: string, args?: JsonObject): Promise<T> {
    if (this.exited) {
      return Promise.reject(new Error('tsserver is not running'))
    }

    const seq = this.nextSeq()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`Timed out waiting for tsserver command "${command}"`))
      }, this.timeoutMs)

      this.pending.set(seq, {
        command,
        resolve,
        reject,
        timeout,
      })

      this.writeMessage({
        seq,
        type: 'request',
        command,
        arguments: args,
      })
    }) as Promise<T>
  }

  dispose(): void {
    if (this.exited) return

    try {
      this.notify('exit')
      this.child.stdin.end()
    } catch {
      // The process may already be closing after a failed command.
    }

    setTimeout(() => {
      if (!this.exited) {
        this.child.kill('SIGTERM')
      }
    }, 500).unref()
  }

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  private writeMessage(message: JsonObject): void {
    const payload = JSON.stringify(message)
    this.child.stdin.write(`${payload}\n`)
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    while (true) {
      const separator = findHeaderSeparator(this.buffer)
      if (!separator) return

      const header = this.buffer.subarray(0, separator.index).toString('utf8')
      const lengthMatch = /^Content-Length:\s*(\d+)$/im.exec(header)

      if (!lengthMatch) {
        throw new Error(`Invalid tsserver protocol header: ${header}`)
      }

      const contentLength = Number(lengthMatch[1])
      const bodyStart = separator.index + separator.length
      const messageEnd = bodyStart + contentLength

      if (this.buffer.length < messageEnd) return

      const payload = this.buffer.subarray(bodyStart, messageEnd).toString('utf8')
      this.buffer = this.buffer.subarray(messageEnd)
      this.handleMessage(JSON.parse(payload) as ProtocolMessage)
    }
  }

  private handleMessage(message: ProtocolMessage): void {
    if (message.type !== 'response') return

    const pending = this.pending.get(message.request_seq)
    if (!pending) return

    this.pending.delete(message.request_seq)
    clearTimeout(pending.timeout)

    if (!message.success) {
      pending.reject(new Error(`${pending.command} failed: ${message.message ?? 'unknown error'}`))
      return
    }

    pending.resolve(message.body)
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)
  const command = rawArgs.shift()
  const { options, args } = parseGlobalOptions(rawArgs)

  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h' ||
    args.includes('--help') ||
    args.includes('-h')
  ) {
    printHelp()
    return
  }

  const client = new TsServerClient(options.timeoutMs)

  try {
    const result = await runCommand(client, normalizeCommand(command), args, options)
    printJson(result, options)
  } finally {
    client.dispose()
  }
}

async function runCommand(
  client: TsServerClient,
  command: string,
  args: string[],
  options: GlobalOptions,
): Promise<unknown> {
  switch (command) {
    case 'hover':
      return hover(client, parseLocationArg(requiredArg(args, 0, 'location')), options)
    case 'definition':
      return definition(client, parseLocationArg(requiredArg(args, 0, 'location')), options)
    case 'references':
      return references(client, parseLocationArg(requiredArg(args, 0, 'location')), args, options)
    case 'diagnostics':
      return diagnostics(client, args[0] ? resolveFile(args[0]) : undefined, options)
    case 'symbols':
      return documentSymbols(client, resolveFile(requiredArg(args, 0, 'file')), options)
    case 'workspace-symbols':
      return workspaceSymbols(client, requiredArg(args, 0, 'query'), args, options)
    case 'rename-preview':
      return rename(client, parseLocationArg(requiredArg(args, 0, 'location')), requiredArg(args, 1, 'newName'), {
        apply: false,
        args,
        options,
      })
    case 'rename-apply':
      return rename(client, parseLocationArg(requiredArg(args, 0, 'location')), requiredArg(args, 1, 'newName'), {
        apply: true,
        args,
        options,
      })
    case 'code-actions':
      return codeActions(client, parseLocationArg(requiredArg(args, 0, 'location')), args, options)
    case 'organize-imports':
      return organizeImports(client, resolveFile(requiredArg(args, 0, 'file')), args, options)
    case 'project-files':
      return projectFiles(options)
    default:
      throw new Error(`Unknown ts:agent command "${command}". Run "pnpm ts:agent help".`)
  }
}

async function hover(client: TsServerClient, location: ParsedLocation, options: GlobalOptions): Promise<unknown> {
  await client.openFile(location.file)

  const body = await client.request<JsonObject | undefined>('quickinfo', {
    file: location.file,
    line: location.line,
    offset: location.character,
  })

  return {
    command: 'hover',
    location: outputLocation(location, options),
    result: body
      ? {
          kind: body.kind,
          kindModifiers: body.kindModifiers,
          display: body.displayString,
          documentation: body.documentation,
          tags: body.tags,
          range: protocolStartEndToRange(body, location.file),
        }
      : null,
  }
}

async function definition(client: TsServerClient, location: ParsedLocation, options: GlobalOptions): Promise<unknown> {
  await client.openFile(location.file)

  const body = await client.request<unknown[]>('definition', {
    file: location.file,
    line: location.line,
    offset: location.character,
  })

  const definitions = (body ?? []).map((item) => protocolSpanToOutput(item, options))

  return {
    command: 'definition',
    location: outputLocation(location, options),
    count: definitions.length,
    definitions,
  }
}

async function references(
  client: TsServerClient,
  location: ParsedLocation,
  args: string[],
  options: GlobalOptions,
): Promise<unknown> {
  await client.openFile(location.file)

  const includeDeclaration = takeBooleanFlag(args, '--include-declaration')
  const body = await client.request<JsonObject | undefined>('references', {
    file: location.file,
    line: location.line,
    offset: location.character,
  })

  const refs = Array.isArray(body?.refs) ? (body.refs as JsonObject[]) : []
  const references = refs
    .filter((ref) => includeDeclaration || ref.isDefinition !== true)
    .map((ref) => {
      const file = resolveProtocolFile(ref)
      const start = asProtocolLocation(ref.start)

      return {
        file: displayPath(file, options),
        absoluteFile: file,
        line: start?.line,
        character: start?.offset,
        isDefinition: ref.isDefinition === true,
        isWriteAccess: ref.isWriteAccess === true,
        text: typeof ref.lineText === 'string' ? ref.lineText.trim() : undefined,
      }
    })

  return {
    command: 'references',
    location: outputLocation(location, options),
    symbolName: body?.symbolName,
    symbolDisplay: body?.symbolDisplayString,
    count: references.length,
    references,
  }
}

async function diagnostics(client: TsServerClient, file: string | undefined, options: GlobalOptions): Promise<unknown> {
  const files = file ? [file] : getProjectFileList(resolveProjectPath(options.project))
  const diagnostics = []

  if (files.length > 0) {
    await client.openFile(file ?? files[0])
  }

  for (const targetFile of files) {
    diagnostics.push(...(await diagnosticsForFile(client, targetFile, 'syntactic', options)))
    diagnostics.push(...(await diagnosticsForFile(client, targetFile, 'semantic', options)))
    diagnostics.push(...(await diagnosticsForFile(client, targetFile, 'suggestion', options)))
  }

  return {
    command: 'diagnostics',
    project: file ? undefined : displayPath(resolveProjectPath(options.project), options),
    file: file ? displayPath(file, options) : undefined,
    fileCount: files.length,
    count: diagnostics.length,
    diagnostics,
  }
}

async function documentSymbols(client: TsServerClient, file: string, options: GlobalOptions): Promise<unknown> {
  await client.openFile(file)

  const body = await client.request<JsonObject | undefined>('navtree', {
    file,
  })

  const symbols = flattenNavTree(body, file, [], options)

  return {
    command: 'symbols',
    file: displayPath(file, options),
    count: symbols.length,
    symbols,
  }
}

async function workspaceSymbols(
  client: TsServerClient,
  query: string,
  args: string[],
  options: GlobalOptions,
): Promise<unknown> {
  const limit = parsePositiveInteger(takeOption(args, '--limit'), 50)
  const project = resolveProjectPath(options.project)
  const files = getProjectFileList(project)

  if (files.length > 0) {
    await client.openFile(files[0])
  }

  const body = await client.request<unknown[]>('navto', {
    searchValue: query,
    maxResultCount: limit,
    projectFileName: project,
  })

  const symbols = (body ?? []).map((item) => protocolSpanToOutput(item, options))

  return {
    command: 'workspace-symbols',
    project: displayPath(project, options),
    query,
    count: symbols.length,
    symbols,
  }
}

async function rename(
  client: TsServerClient,
  location: ParsedLocation,
  newName: string,
  renameOptions: {
    apply: boolean
    args: string[]
    options: GlobalOptions
  },
): Promise<unknown> {
  const { args, options } = renameOptions
  await client.openFile(location.file)

  const findInStrings = takeBooleanFlag(args, '--strings')
  const findInComments = takeBooleanFlag(args, '--comments')
  const body = await client.request<JsonObject | undefined>('rename', {
    file: location.file,
    line: location.line,
    offset: location.character,
    findInStrings,
    findInComments,
  })
  const info = (body?.info ?? {}) as JsonObject

  if (info.canRename === false) {
    throw new Error(`Cannot rename symbol: ${info.localizedErrorMessage ?? 'unknown reason'}`)
  }

  const locs = Array.isArray(body?.locs) ? (body.locs as JsonObject[]) : []
  const edits = buildRenameEdits(locs, newName, options)
  const applied = renameOptions.apply ? applyEdits(edits, options) : undefined

  return {
    command: renameOptions.apply ? 'rename-apply' : 'rename-preview',
    location: outputLocation(location, options),
    newName,
    info: {
      displayName: info.displayName,
      fullDisplayName: info.fullDisplayName,
      kind: info.kind,
      kindModifiers: info.kindModifiers,
    },
    fileCount: groupEditsByFile(edits).length,
    editCount: edits.length,
    edits: groupEditsByFile(edits).map((group) => ({
      file: displayPath(group.file, options),
      absoluteFile: group.file,
      edits: group.edits.map(({ absoluteFile: _absoluteFile, file: _file, ...edit }) => edit),
    })),
    applied,
  }
}

async function codeActions(
  client: TsServerClient,
  location: ParsedLocation,
  args: string[],
  options: GlobalOptions,
): Promise<unknown> {
  await client.openFile(location.file)

  const codeValues = takeAllOptions(args, '--code').map((code) => Number(code))
  const endLine = Number(takeOption(args, '--end-line') ?? location.line)
  const endCharacter = Number(takeOption(args, '--end-character') ?? location.character)
  const errorCodes = codeValues.length > 0 ? codeValues : await diagnosticCodesAt(client, location, options)

  if (errorCodes.length === 0) {
    return {
      command: 'code-actions',
      location: outputLocation(location, options),
      count: 0,
      actions: [],
      note: 'No diagnostics covered this location. Pass --code <number> to request a specific code fix.',
    }
  }

  const body = await client.request<JsonObject[]>('getCodeFixes', {
    file: location.file,
    startLine: location.line,
    startOffset: location.character,
    endLine,
    endOffset: endCharacter,
    errorCodes,
  })

  const actions = (body ?? []).map((action) => ({
    fixName: action.fixName,
    description: action.description,
    fixId: action.fixId,
    fixAllDescription: action.fixAllDescription,
    changes: formatFileCodeEdits(action.changes, options),
  }))

  return {
    command: 'code-actions',
    location: outputLocation(location, options),
    errorCodes,
    count: actions.length,
    actions,
  }
}

async function organizeImports(
  client: TsServerClient,
  file: string,
  args: string[],
  options: GlobalOptions,
): Promise<unknown> {
  await client.openFile(file)

  const write = takeBooleanFlag(args, '--write')
  const body = await client.request<JsonObject[]>('organizeImports', {
    scope: {
      type: 'file',
      args: {
        file,
      },
    },
    skipDestructiveCodeActions: true,
  })

  const edits = fileCodeEditsToTextEdits(body ?? [], options)
  const applied = write ? applyEdits(edits, options) : undefined

  return {
    command: 'organize-imports',
    file: displayPath(file, options),
    write,
    fileCount: groupEditsByFile(edits).length,
    editCount: edits.length,
    edits: groupEditsByFile(edits).map((group) => ({
      file: displayPath(group.file, options),
      absoluteFile: group.file,
      edits: group.edits.map(({ absoluteFile: _absoluteFile, file: _file, ...edit }) => edit),
    })),
    applied,
  }
}

function projectFiles(options: GlobalOptions): unknown {
  const project = resolveProjectPath(options.project)
  const files = getProjectFileList(project)

  return {
    command: 'project-files',
    project: displayPath(project, options),
    count: files.length,
    files: files.map((file) => displayPath(file, options)),
  }
}

async function diagnosticsForFile(
  client: TsServerClient,
  file: string,
  kind: 'syntactic' | 'semantic' | 'suggestion',
  options: GlobalOptions,
): Promise<unknown[]> {
  const commandByKind = {
    syntactic: 'syntacticDiagnosticsSync',
    semantic: 'semanticDiagnosticsSync',
    suggestion: 'suggestionDiagnosticsSync',
  }

  try {
    const body = await client.request<JsonObject[]>(commandByKind[kind], {
      file,
      includeLinePosition: true,
    })

    return (body ?? []).map((diagnostic) => formatDiagnostic(diagnostic, file, kind, options))
  } catch (error) {
    if (kind === 'suggestion') return []
    throw error
  }
}

async function diagnosticCodesAt(
  client: TsServerClient,
  location: ParsedLocation,
  options: GlobalOptions,
): Promise<number[]> {
  const diagnostics = [
    ...(await diagnosticsForFile(client, location.file, 'syntactic', options)),
    ...(await diagnosticsForFile(client, location.file, 'semantic', options)),
    ...(await diagnosticsForFile(client, location.file, 'suggestion', options)),
  ] as Array<{ code?: number; line?: number; character?: number; endLine?: number; endCharacter?: number }>

  return [
    ...new Set(
      diagnostics
        .filter((diagnostic) => diagnostic.code && locationInRange(location, diagnostic))
        .map((diagnostic) => diagnostic.code as number),
    ),
  ]
}

function formatDiagnostic(
  diagnostic: JsonObject,
  file: string,
  source: 'syntactic' | 'semantic' | 'suggestion',
  options: GlobalOptions,
): unknown {
  const start = asProtocolLocation(diagnostic.startLocation) ?? asProtocolLocation(diagnostic.start)
  const end = asProtocolLocation(diagnostic.endLocation) ?? asProtocolLocation(diagnostic.end)
  const numericRange =
    !start && typeof diagnostic.start === 'number' && typeof diagnostic.length === 'number'
      ? textSpanToRange(file, {
          start: diagnostic.start,
          length: diagnostic.length,
        })
      : undefined

  return {
    file: displayPath(file, options),
    absoluteFile: file,
    line: start?.line ?? numericRange?.line,
    character: start?.offset ?? numericRange?.character,
    endLine: end?.line ?? numericRange?.endLine,
    endCharacter: end?.offset ?? numericRange?.endCharacter,
    message: diagnostic.text ?? diagnostic.messageText ?? diagnostic.message,
    category: normalizeDiagnosticCategory(diagnostic.category),
    code: diagnostic.code,
    source,
  }
}

function normalizeDiagnosticCategory(category: unknown): string {
  if (typeof category === 'string') return category
  if (typeof category === 'number') return ts.DiagnosticCategory[category]?.toLowerCase() ?? String(category)
  return 'message'
}

function flattenNavTree(
  item: JsonObject | undefined,
  file: string,
  parents: string[],
  options: GlobalOptions,
): unknown[] {
  if (!item) return []

  const text = typeof item.text === 'string' ? item.text : '<anonymous>'
  const pathParts = [...parents, text].filter((part) => part !== '<global>')
  const symbols = []
  const span = firstSymbolSpan(item)

  if (text !== '<global>') {
    const range = spanToRange(file, span)
    symbols.push({
      name: text,
      path: pathParts.join('.'),
      kind: item.kind,
      kindModifiers: item.kindModifiers,
      file: displayPath(file, options),
      absoluteFile: file,
      ...range,
    })
  }

  const children = Array.isArray(item.childItems) ? (item.childItems as JsonObject[]) : []

  for (const child of children) {
    symbols.push(...flattenNavTree(child, file, pathParts, options))
  }

  return symbols
}

function protocolSpanToOutput(item: unknown, options: GlobalOptions): unknown {
  const record = item as JsonObject
  const file = resolveProtocolFile(record)
  const start = asProtocolLocation(record.start)
  const end = asProtocolLocation(record.end)
  const textSpan = asProtocolTextSpan(record.textSpan)
  const range = start
    ? {
        line: start.line,
        character: start.offset,
        endLine: end?.line,
        endCharacter: end?.offset,
      }
    : textSpan
      ? textSpanToRange(file, textSpan)
      : {}

  return {
    file: displayPath(file, options),
    absoluteFile: file,
    name: record.name,
    kind: record.kind,
    kindModifiers: record.kindModifiers,
    containerName: record.containerName,
    containerKind: record.containerKind,
    matchKind: record.matchKind,
    ...range,
  }
}

function protocolStartEndToRange(record: JsonObject, fallbackFile: string): OutputRange | undefined {
  const start = asProtocolLocation(record.start)
  const end = asProtocolLocation(record.end)

  if (start && end) {
    return {
      line: start.line,
      character: start.offset,
      endLine: end.line,
      endCharacter: end.offset,
    }
  }

  const span = asProtocolTextSpan(record.textSpan)
  return span ? textSpanToRange(resolveProtocolFile(record, fallbackFile), span) : undefined
}

function buildRenameEdits(spanGroups: JsonObject[], newName: string, options: GlobalOptions): TextEdit[] {
  return spanGroups.flatMap((spanGroup) => {
    const file = resolveProtocolFile(spanGroup)
    const locs = Array.isArray(spanGroup.locs) ? (spanGroup.locs as JsonObject[]) : []

    return locs.map((location) => {
      const edit = protocolEditToTextEdit(file, location, newName, options)
      const prefix = typeof location.prefixText === 'string' ? location.prefixText : ''
      const suffix = typeof location.suffixText === 'string' ? location.suffixText : ''

      return {
        ...edit,
        newText: `${prefix}${newName}${suffix}`,
      }
    })
  })
}

function fileCodeEditsToTextEdits(changes: JsonObject[], options: GlobalOptions): TextEdit[] {
  return changes.flatMap((change) => {
    const file = resolveProtocolFile(change)
    const textChanges = Array.isArray(change.textChanges) ? (change.textChanges as JsonObject[]) : []

    return textChanges.map((textChange) =>
      protocolEditToTextEdit(
        file,
        textChange,
        typeof textChange.newText === 'string' ? textChange.newText : '',
        options,
      ),
    )
  })
}

function formatFileCodeEdits(changes: unknown, options: GlobalOptions): unknown[] {
  const edits = fileCodeEditsToTextEdits(Array.isArray(changes) ? (changes as JsonObject[]) : [], options)

  return groupEditsByFile(edits).map((group) => ({
    file: displayPath(group.file, options),
    absoluteFile: group.file,
    edits: group.edits.map(({ absoluteFile: _absoluteFile, file: _file, ...edit }) => edit),
  }))
}

function applyEdits(edits: TextEdit[], options: GlobalOptions): unknown {
  const groups = groupEditsByFile(edits)

  for (const group of groups) {
    const text = readFileText(group.file)
    const sorted = [...group.edits].sort((left, right) => right.start - left.start)
    let previousStart = Number.POSITIVE_INFINITY
    let nextText = text

    for (const edit of sorted) {
      if (edit.end > previousStart) {
        throw new Error(`Overlapping edits for ${group.file}`)
      }

      nextText = `${nextText.slice(0, edit.start)}${edit.newText}${nextText.slice(edit.end)}`
      previousStart = edit.start
    }

    if (nextText !== text) {
      writeFileSync(group.file, nextText)
    }
  }

  return {
    fileCount: groups.length,
    editCount: edits.length,
    files: groups.map((group) => displayPath(group.file, options)),
  }
}

function groupEditsByFile(edits: TextEdit[]): Array<{ file: string; edits: TextEdit[] }> {
  const groups = new Map<string, TextEdit[]>()

  for (const edit of edits) {
    const group = groups.get(edit.absoluteFile) ?? []
    group.push(edit)
    groups.set(edit.absoluteFile, group)
  }

  return [...groups.entries()].map(([file, groupEdits]) => ({
    file,
    edits: groupEdits,
  }))
}

function locationInRange(
  location: ParsedLocation,
  range: { line?: number; character?: number; endLine?: number; endCharacter?: number },
): boolean {
  if (!range.line || !range.character) return false

  const endLine = range.endLine ?? range.line
  const endCharacter = range.endCharacter ?? range.character

  if (location.line < range.line || location.line > endLine) return false
  if (location.line === range.line && location.character < range.character) return false
  if (location.line === endLine && location.character > endCharacter) return false
  return true
}

function textSpanToRange(file: string, span: ProtocolTextSpan): OutputRange {
  const start = positionToLineCharacter(file, span.start)
  const end = positionToLineCharacter(file, span.start + span.length)

  return {
    line: start.line,
    character: start.character,
    endLine: end.line,
    endCharacter: end.character,
  }
}

function protocolEditToTextEdit(
  file: string,
  protocolEdit: JsonObject,
  newText: string,
  options: GlobalOptions,
): TextEdit {
  const span = asProtocolTextSpan(protocolEdit.span ?? protocolEdit.textSpan)

  if (span) {
    return {
      file: displayPath(file, options),
      absoluteFile: file,
      start: span.start,
      end: span.start + span.length,
      oldText: readFileText(file).slice(span.start, span.start + span.length),
      newText,
      ...textSpanToRange(file, span),
    }
  }

  const startLocation = asProtocolLocation(protocolEdit.start)
  const endLocation = asProtocolLocation(protocolEdit.end)

  if (!startLocation || !endLocation) {
    throw new Error('tsserver returned an edit without a supported span')
  }

  const start = lineOffsetToPosition(file, startLocation)
  const end = lineOffsetToPosition(file, endLocation)

  return {
    file: displayPath(file, options),
    absoluteFile: file,
    start,
    end,
    oldText: readFileText(file).slice(start, end),
    newText,
    line: startLocation.line,
    character: startLocation.offset,
    endLine: endLocation.line,
    endCharacter: endLocation.offset,
  }
}

function lineOffsetToPosition(file: string, location: ProtocolLocation): number {
  return getSourceFile(file).getPositionOfLineAndCharacter(location.line - 1, location.offset - 1)
}

function positionToLineCharacter(file: string, position: number): { line: number; character: number } {
  const lineAndCharacter = getSourceFile(file).getLineAndCharacterOfPosition(position)

  return {
    line: lineAndCharacter.line + 1,
    character: lineAndCharacter.character + 1,
  }
}

function getSourceFile(file: string): ts.SourceFile {
  const cached = sourceFileCache.get(file)
  if (cached) return cached

  const sourceFile = ts.createSourceFile(
    file,
    readFileText(file),
    ts.ScriptTarget.Latest,
    true,
    scriptKindFromFileName(file),
  )

  sourceFileCache.set(file, sourceFile)
  return sourceFile
}

function scriptKindFromFileName(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return ts.ScriptKind.JS
  if (file.endsWith('.json')) return ts.ScriptKind.JSON
  return ts.ScriptKind.TS
}

function firstSymbolSpan(item: JsonObject): unknown {
  const spans = Array.isArray(item.spans) ? (item.spans as unknown[]) : []
  return item.nameSpan ?? spans[0] ?? item.textSpan
}

function spanToRange(file: string, span: unknown): OutputRange | undefined {
  const textSpan = asProtocolTextSpan(span)
  if (textSpan) return textSpanToRange(file, textSpan)

  const record = span as JsonObject | undefined
  const start = asProtocolLocation(record?.start)
  const end = asProtocolLocation(record?.end)

  if (!start || !end) return undefined

  return {
    line: start.line,
    character: start.offset,
    endLine: end.line,
    endCharacter: end.offset,
  }
}

function asProtocolTextSpan(value: unknown): ProtocolTextSpan | undefined {
  const record = value as JsonObject | undefined
  const start = record?.start
  const length = record?.length

  if (typeof start === 'number' && typeof length === 'number') {
    return {
      start,
      length,
    }
  }

  return undefined
}

function asProtocolLocation(value: unknown): ProtocolLocation | undefined {
  const record = value as JsonObject | undefined
  const line = record?.line
  const offset = record?.offset

  if (typeof line === 'number' && typeof offset === 'number') {
    return {
      line,
      offset,
    }
  }

  return undefined
}

function resolveProtocolFile(record: JsonObject, fallback?: string): string {
  const file = record.file ?? record.fileName ?? fallback

  if (typeof file !== 'string') {
    throw new Error('tsserver response did not include a file path')
  }

  return resolveFile(file)
}

function outputLocation(location: ParsedLocation, options: GlobalOptions): unknown {
  return {
    file: displayPath(location.file, options),
    absoluteFile: location.file,
    line: location.line,
    character: location.character,
  }
}

function parseLocationArg(raw: string): ParsedLocation {
  const match = /^(.*):(\d+):(\d+)$/.exec(raw)

  if (!match) {
    throw new Error(`Expected location as file:line:character, received "${raw}"`)
  }

  return {
    file: resolveFile(match[1]),
    line: parsePositiveInteger(match[2], 1),
    character: parsePositiveInteger(match[3], 1),
  }
}

function resolveFile(raw: string): string {
  const file = path.resolve(repoRoot, raw)

  if (!existsSync(file)) {
    throw new Error(`File does not exist: ${raw}`)
  }

  return file
}

function resolveProjectPath(rawProject: string | undefined): string {
  if (rawProject) return resolveFile(rawProject)

  const config = ts.findConfigFile(repoRoot, ts.sys.fileExists, 'tsconfig.json')

  if (!config) {
    throw new Error('Could not find tsconfig.json')
  }

  return path.resolve(config)
}

function getProjectFileList(project: string): string[] {
  const config = ts.readConfigFile(project, ts.sys.readFile)

  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(project), undefined, project)

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }

  return parsed.fileNames.filter((file) => isTypeScriptLikeFile(file) && !file.includes('/node_modules/'))
}

function isTypeScriptLikeFile(file: string): boolean {
  return /\.(c|m)?tsx?$|\.jsx?$|\.json$/.test(file)
}

function displayPath(file: string, options: Pick<GlobalOptions, 'absolute'>): string {
  if (options.absolute) return path.normalize(file)

  const relative = path.relative(repoRoot, file)
  return relative === '' ? '.' : relative
}

function readFileText(file: string): string {
  return readFileSync(file, 'utf8')
}

function parseGlobalOptions(args: string[]): { options: GlobalOptions; args: string[] } {
  const rest = [...args]
  const project = takeOption(rest, '--project')
  const timeoutMs = parsePositiveInteger(takeOption(rest, '--timeout-ms'), defaultTimeoutMs)
  const options = {
    absolute: takeBooleanFlag(rest, '--absolute'),
    compact: takeBooleanFlag(rest, '--compact'),
    project,
    timeoutMs,
  }

  return {
    options,
    args: rest,
  }
}

function normalizeCommand(command: string): string {
  const aliases: Record<string, string> = {
    diag: 'diagnostics',
    diagnostic: 'diagnostics',
    'document-symbols': 'symbols',
    'find-references': 'references',
    'goto-definition': 'definition',
    'hover-type': 'hover',
    refs: 'references',
  }

  return aliases[command] ?? command
}

function takeBooleanFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name)

  if (index < 0) return false

  args.splice(index, 1)
  return true
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)

  if (index < 0) return undefined

  const value = args[index + 1]

  if (!value || value.startsWith('--')) {
    throw new Error(`Expected value after ${name}`)
  }

  args.splice(index, 2)
  return value
}

function takeAllOptions(args: string[], name: string): string[] {
  const values = []

  while (true) {
    const value = takeOption(args, name)
    if (!value) return values
    values.push(value)
  }
}

function requiredArg(args: string[], index: number, name: string): string {
  const value = args[index]

  if (!value || value.startsWith('--')) {
    throw new Error(`Missing required ${name}`)
  }

  return value
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback

  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${raw}"`)
  }

  return parsed
}

function findHeaderSeparator(buffer: Buffer): { index: number; length: number } | undefined {
  const crlf = buffer.indexOf('\r\n\r\n')
  if (crlf >= 0) return { index: crlf, length: 4 }

  const lf = buffer.indexOf('\n\n')
  if (lf >= 0) return { index: lf, length: 2 }

  return undefined
}

function resolveTsserverLogPath(): string | undefined {
  const raw = process.env.RISU_TS_AGENT_TSSERVER_LOG

  if (!raw || raw === '0' || raw.toLowerCase() === 'false' || raw.toLowerCase() === 'off') {
    return undefined
  }

  const logPath =
    raw === '1' || raw.toLowerCase() === 'true'
      ? path.join(repoRoot, 'data/trace/tsserver-agent.log')
      : path.resolve(repoRoot, raw)

  mkdirSync(path.dirname(logPath), { recursive: true })
  return logPath
}

function printJson(result: unknown, options: GlobalOptions): void {
  console.log(JSON.stringify(result, null, options.compact ? 0 : 2))
}

function printHelp(): void {
  console.log(`Usage:
  pnpm ts:agent hover <file:line:character>
  pnpm ts:agent definition <file:line:character>
  pnpm ts:agent references <file:line:character> [--include-declaration]
  pnpm ts:agent diagnostics [file] [--project tsconfig.json]
  pnpm ts:agent symbols <file>
  pnpm ts:agent workspace-symbols <query> [--project tsconfig.json] [--limit 50]
  pnpm ts:agent rename-preview <file:line:character> <newName> [--strings] [--comments]
  pnpm ts:agent rename-apply <file:line:character> <newName> [--strings] [--comments]
  pnpm ts:agent code-actions <file:line:character> [--code 1234] [--end-line n --end-character n]
  pnpm ts:agent organize-imports <file> [--write]
  pnpm ts:agent project-files [--project tsconfig.json]

Global options:
  --absolute       Output absolute paths instead of repo-relative paths
  --compact        Print compact JSON
  --project <path> Use a specific tsconfig for project-wide commands
  --timeout-ms <n> Override the tsserver request timeout

Locations are 1-based, matching editor line and column displays.
Set RISU_TS_AGENT_TSSERVER_LOG=1 to write a verbose tsserver log to data/trace/tsserver-agent.log.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
