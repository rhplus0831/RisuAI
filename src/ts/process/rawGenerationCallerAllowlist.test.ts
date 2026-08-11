import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
  return source.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1] ?? ''
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
      { file: 'src/ts/process/acceptedSendCoordinator.svelte.ts', localName: 'sendChat', calls: 1 },
      { file: 'src/ts/process/reattach.ts', localName: 'sendChat', calls: 1 },
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
    expect(moduleSource('src/ts/process/reattach.ts')).toContain('reattachJobId: job.jobId')
  })
})
