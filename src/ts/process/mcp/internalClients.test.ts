import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MCPTool } from './mcplib'

const schemaCloneMocks = vi.hoisted(() => ({
  cloneMCPTools: vi.fn(),
  toolInputs: [] as unknown[],
}))

vi.mock('../../globalApi.svelte', () => ({
  fetchNative: vi.fn(),
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => ({
      getItem: vi.fn(async () => undefined),
      setItem: vi.fn(async () => undefined),
    })),
  },
}))

vi.mock('./internalmcp', async (importActual) => {
  const actual = await importActual<typeof import('./internalmcp')>()
  return {
    ...actual,
    cloneMCPTools: (tools: readonly MCPTool[]) => {
      schemaCloneMocks.cloneMCPTools(tools)
      schemaCloneMocks.toolInputs.push(tools)
      return actual.cloneMCPTools(tools)
    },
  }
})

import { clearFileSystemDirectoryHandleForTests, FileSystemClient } from './filesystemclient'
import { GoogleSearchClient } from './googlesearchclient'

type TestDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission: ReturnType<typeof vi.fn>
  requestPermission: ReturnType<typeof vi.fn>
}

function createDirectoryHandle(name: string): TestDirectoryHandle {
  return {
    kind: 'directory',
    name,
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
    entries: async function* () {},
  } as unknown as TestDirectoryHandle
}

beforeEach(() => {
  vi.unstubAllGlobals()
  schemaCloneMocks.cloneMCPTools.mockClear()
  schemaCloneMocks.toolInputs.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {
    /* silence FileSystemClient selection logs */
  })
  clearFileSystemDirectoryHandleForTests()
})

afterEach(() => {
  clearFileSystemDirectoryHandleForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('internal MCP tool schemas', () => {
  it('FileSystem and Google Search return mutation-safe copies of static tool schemas', async () => {
    const fsClient = new FileSystemClient()
    const firstFsTools = await fsClient.getToolList()
    const secondFsTools = await fsClient.getToolList()
    const recreatedFsTools = await new FileSystemClient().getToolList()

    expect(firstFsTools).toHaveLength(12)
    expect(secondFsTools).toHaveLength(12)
    expect(recreatedFsTools).toHaveLength(12)
    expect(firstFsTools).not.toBe(secondFsTools)
    expect(firstFsTools[0]).not.toBe(secondFsTools[0])
    firstFsTools[0].inputSchema.properties.path.description = 'mutated by caller'
    expect(secondFsTools[0].inputSchema.properties.path.description).toBe(
      'Path to the file relative to selected directory',
    )

    const googleClient = new GoogleSearchClient()
    const firstGoogleTools = await googleClient.getToolList()
    const secondGoogleTools = await googleClient.getToolList()
    const recreatedGoogleTools = await new GoogleSearchClient().getToolList()

    expect(firstGoogleTools).toHaveLength(2)
    expect(secondGoogleTools).toHaveLength(2)
    expect(recreatedGoogleTools).toHaveLength(2)
    expect(firstGoogleTools).not.toBe(secondGoogleTools)
    expect(firstGoogleTools[0]).not.toBe(secondGoogleTools[0])
    firstGoogleTools[0].inputSchema.properties.query.description = 'mutated by caller'
    expect(secondGoogleTools[0].inputSchema.properties.query.description).toBe('The search query to execute')

    const cloneInputs = schemaCloneMocks.toolInputs as Array<readonly MCPTool[]>
    const fsSchemaSources = cloneInputs.filter((tools) => tools.some((tool) => tool.name === 'fs_read_file'))
    const googleSchemaSources = cloneInputs.filter((tools) => tools.some((tool) => tool.name === 'google_search'))
    expect(schemaCloneMocks.cloneMCPTools).toHaveBeenCalledTimes(6)
    expect(fsSchemaSources).toHaveLength(3)
    expect(new Set(fsSchemaSources).size).toBe(1)
    expect(googleSchemaSources).toHaveLength(3)
    expect(new Set(googleSchemaSources).size).toBe(1)
  })
})

describe('FileSystem MCP directory handle reuse', () => {
  it('reuses a valid directory handle across FileSystem client recreation', async () => {
    const handle = createDirectoryHandle('workspace')
    const picker = vi.fn(async () => handle)
    vi.stubGlobal('showDirectoryPicker', picker)

    await new FileSystemClient().checkHandshake()
    await new FileSystemClient().checkHandshake()

    expect(picker).toHaveBeenCalledTimes(1)
    expect(handle.queryPermission).toHaveBeenCalledTimes(2)
  })

  it('prompts again only after the stored directory handle becomes invalid', async () => {
    const firstHandle = createDirectoryHandle('old-workspace')
    const secondHandle = createDirectoryHandle('new-workspace')
    const picker = vi.fn().mockResolvedValueOnce(firstHandle).mockResolvedValueOnce(secondHandle)
    vi.stubGlobal('showDirectoryPicker', picker)

    await new FileSystemClient().checkHandshake()
    firstHandle.queryPermission.mockRejectedValue(new DOMException('gone', 'NotFoundError'))
    await new FileSystemClient().checkHandshake()

    expect(picker).toHaveBeenCalledTimes(2)
    expect(secondHandle.queryPermission).toHaveBeenCalledTimes(1)
  })
})
