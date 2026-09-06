import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BROWSER_RAW_GENERATION_OPERATION_IDS } from '../server/browserOperationManifest'

interface RawSendBinding {
  file: string
  localName: string
}

const repositoryRoot = process.cwd()
const sourceRoot = path.join(repositoryRoot, 'src')
const rawGenerationModule = 'src/ts/process/index.svelte'

function runtimeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (['__fixtures__', '__tests__', 'docs'].includes(entry.name)) return []
      return runtimeSourceFiles(absolute)
    }
    const relative = path.relative(repositoryRoot, absolute).split(path.sep).join('/')
    if (!/\.(?:svelte|ts)$/.test(entry.name)) return []
    if (/\.(?:d|spec|test)\.ts$/.test(entry.name)) return []
    return [relative]
  })
}

function moduleSource(file: string): string {
  const source = readFileSync(path.join(repositoryRoot, file), 'utf8')
  if (!file.endsWith('.svelte')) return source
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
}

function fullSource(file: string): string {
  return readFileSync(path.join(repositoryRoot, file), 'utf8')
}

function resolvesToRawGenerationModule(file: string, specifier: string): boolean {
  if (specifier.startsWith('src/')) return specifier === rawGenerationModule
  const resolved = path
    .normalize(path.join(path.dirname(file), specifier))
    .split(path.sep)
    .join('/')
  return resolved === rawGenerationModule
}

function importedRawSendBindings(file: string): RawSendBinding[] {
  const source = moduleSource(file)
  const bindings: RawSendBinding[] = []
  const staticImports = source.matchAll(/import\s*{([\s\S]*?)}\s*from\s*['"]([^'"]+)['"]/g)
  for (const match of staticImports) {
    if (!resolvesToRawGenerationModule(file, match[2])) continue
    for (const imported of match[1].split(',')) {
      const sendBinding = /^\s*sendChat(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(imported)
      if (sendBinding) bindings.push({ file, localName: sendBinding[1] ?? 'sendChat' })
    }
  }

  const dynamicImports = source.matchAll(/(?:const|let)\s*{([\s\S]*?)}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)
  for (const match of dynamicImports) {
    if (!resolvesToRawGenerationModule(file, match[2])) continue
    for (const imported of match[1].split(',')) {
      const sendBinding = /^\s*sendChat(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(imported)
      if (sendBinding) bindings.push({ file, localName: sendBinding[1] ?? 'sendChat' })
    }
  }
  return bindings
}

function callCount(source: string, localName: string): number {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...source.matchAll(new RegExp(`\\b${escaped}\\s*\\(`, 'g'))].length
}

describe('raw chat generation caller allowlist', () => {
  it('keeps append-and-generate callers behind the accepted-send coordinator', () => {
    const bindings = runtimeSourceFiles(sourceRoot)
      .flatMap(importedRawSendBindings)
      .map((binding) => ({
        ...binding,
        calls: callCount(moduleSource(binding.file), binding.localName),
      }))
      .sort((left, right) => left.file.localeCompare(right.file))

    expect(bindings).toEqual([
      { file: 'src/lib/ChatScreens/DefaultChatScreen.svelte', localName: 'sendChat', calls: 1 },
      { file: 'src/lib/SideBars/DevTool.svelte', localName: 'sendChat', calls: 1 },
      { file: 'src/ts/hotkey.ts', localName: 'sendChat', calls: 1 },
      { file: 'src/ts/plugins/apiV3/v3.svelte.ts', localName: 'processSendChat', calls: 1 },
      { file: 'src/ts/process/acceptedSendCoordinator.svelte.ts', localName: 'sendChat', calls: 2 },
    ])

    const internalCoordinator = moduleSource('src/ts/process/index.svelte.ts')
    expect(callCount(internalCoordinator, 'sendChat')).toBe(2)

    expect(moduleSource('src/lib/ChatScreens/DefaultChatScreen.svelte')).toContain('continue: continued')
    expect(moduleSource('src/lib/SideBars/DevTool.svelte')).toContain("preview: previewJoin !== 'prompt'")
    expect(moduleSource('src/ts/hotkey.ts')).toContain('previewPrompt: true')
    expect(moduleSource('src/ts/plugins/apiV3/v3.svelte.ts')).toContain('return processSendChat(-1')
    expect(moduleSource('src/ts/process/acceptedSendCoordinator.svelte.ts')).toContain(
      'async function attemptGeneration',
    )
    const reattach = moduleSource('src/ts/process/reattach.ts')
    expect(reattach).toContain('getGenerationProcessRuntime()')
    expect(reattach).toContain('reattachJobId: job.jobId')
  })

  it('keeps every Wave 3 append-and-generate caller on the capability-gated atomic submit path', () => {
    expect(BROWSER_RAW_GENERATION_OPERATION_IDS).toEqual({
      atomicSubmit: 'generation-operation-submit',
      compatibilityChat: 'generation-chat',
    })
    const expectedAtomicCalls = [
      ['src/lib/ChatScreens/DefaultChatScreen.svelte', 'message: userMessage'],
      ['src/lib/SideBars/DevTool.svelte', 'message: autopilot[i]'],
      ['src/ts/plugins/apiV3/v3.svelte.ts', 'coordinateAcceptedChatSend({ target, message })'],
      ['src/ts/process/command.ts', 'message: e'],
      ['src/ts/process/files/multisend.ts', 'message: text'],
    ] as const

    for (const [file, atomicCall] of expectedAtomicCalls) {
      const source = fullSource(file)
      expect(source, file).toContain('canUseGenerationOperationProtocol')
      expect(source, file).toContain(atomicCall)
      expect(source, `${file} compatibility path`).toContain('appendCurrentChatUserMessageForSend')
    }
  })
})
