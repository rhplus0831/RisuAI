import { beforeEach, describe, expect, it, vi } from 'vitest'

const specializedToolMocks = vi.hoisted(() => ({
  graphMemory: '',
  getChatVar: vi.fn(),
  setChatVar: vi.fn(),
  embedDocuments: vi.fn(),
  similaritySearch: vi.fn(),
}))

vi.mock('src/ts/parser/chatVar.svelte', () => ({
  getChatVar: specializedToolMocks.getChatVar,
  setChatVar: specializedToolMocks.setChatVar,
}))

vi.mock('../memory/hypamemory', () => ({
  HypaProcesser: class {
    embedDocuments = specializedToolMocks.embedDocuments
    similaritySearch = specializedToolMocks.similaritySearch
  },
}))

import { DICE_MAX_COUNT, DICE_MAX_SIDES, DiceClient } from './dice'
import { GRAPH_MEMORY_MAX_SEARCH_DEPTH, GraphMemClient } from './graphmem'

function text(result: Awaited<ReturnType<GraphMemClient['callTool']>>): string {
  expect(result).toHaveLength(1)
  expect(result[0]?.type).toBe('text')
  return result[0]?.type === 'text' ? result[0].text : ''
}

describe('specialized MCP tool contracts', () => {
  beforeEach(() => {
    specializedToolMocks.graphMemory = ''
    specializedToolMocks.getChatVar.mockReset()
    specializedToolMocks.getChatVar.mockImplementation(() => specializedToolMocks.graphMemory)
    specializedToolMocks.setChatVar.mockReset()
    specializedToolMocks.setChatVar.mockImplementation((_key: string, value: string) => {
      specializedToolMocks.graphMemory = value
    })
    specializedToolMocks.embedDocuments.mockReset()
    specializedToolMocks.similaritySearch.mockReset()
    specializedToolMocks.similaritySearch.mockResolvedValue([])
  })

  it('keeps the Dice and GraphMem advertised tool catalogs exact and mutation-safe', async () => {
    const dice = new DiceClient()
    const graph = new GraphMemClient()

    const firstDiceTools = await dice.getToolList()
    const secondDiceTools = await dice.getToolList()
    const firstGraphTools = await graph.getToolList()
    const secondGraphTools = await graph.getToolList()

    expect(firstDiceTools.map((tool) => tool.name)).toEqual(['rollDice'])
    expect(firstGraphTools.map((tool) => tool.name)).toEqual(['writeMemory', 'readMemory'])
    expect(firstDiceTools).not.toBe(secondDiceTools)
    expect(firstGraphTools).not.toBe(secondGraphTools)
    firstGraphTools[0]!.inputSchema.required = []
    expect(secondGraphTools[0]?.inputSchema.required).toEqual(['name', 'summary'])
  })

  it('rolls supported single or separated expressions while rejecting partial and unbounded notation', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const client = new DiceClient()

    expect(text(await client.callTool('rollDice', { notation: '2d6+3; d4' }))).toBe(
      'Rolled 2d6+3; d4: 6 (Details: 2d6+3: [1, 1] +3 = 5; 1d4: [1] = 1)',
    )
    expect(text(await client.callTool('rollDice', { notation: 'not dice' }))).toContain('Invalid dice notation')
    expect(text(await client.callTool('rollDice', { notation: '2d6 trailing' }))).toContain('Invalid dice notation')
    expect(text(await client.callTool('rollDice', { notation: '0d6' }))).toContain(`between 1 and ${DICE_MAX_COUNT}`)
    expect(text(await client.callTool('rollDice', { notation: `${DICE_MAX_COUNT + 1}d6` }))).toContain(
      `between 1 and ${DICE_MAX_COUNT}`,
    )
    expect(text(await client.callTool('rollDice', { notation: `d${DICE_MAX_SIDES + 1}` }))).toContain(
      `between 1 and ${DICE_MAX_SIDES}`,
    )
  })

  it('validates GraphMem writes before applying a durable chat-variable mutation', async () => {
    const client = new GraphMemClient()

    expect(text(await client.callTool('writeMemory', { name: 'Lantern', summary: 'Keep it lit.' }))).toBe(
      'Memory entry "Lantern" written successfully.',
    )
    expect(JSON.parse(specializedToolMocks.graphMemory)).toEqual([
      { name: 'Lantern', summary: 'Keep it lit.', connections: [] },
    ])
    expect(specializedToolMocks.setChatVar).toHaveBeenCalledWith('graphmem_graph', specializedToolMocks.graphMemory)

    specializedToolMocks.setChatVar.mockClear()
    expect(text(await client.callTool('writeMemory', { name: '', summary: 'invalid' }))).toContain(
      'name must not be empty',
    )
    expect(text(await client.callTool('writeMemory', { name: 'Bad', summary: 'invalid', connections: [3] }))).toContain(
      'array of strings',
    )
    expect(specializedToolMocks.setChatVar).not.toHaveBeenCalled()
  })

  it('fails closed without overwriting malformed GraphMem state', async () => {
    specializedToolMocks.graphMemory = '{not-json'
    const client = new GraphMemClient()

    expect(text(await client.callTool('writeMemory', { name: 'New', summary: 'Do not apply' }))).toContain(
      'Stored graph memory is malformed; no changes were applied.',
    )
    expect(text(await client.callTool('readMemory', { query: ['New'] }))).toContain(
      'Stored graph memory is malformed; no changes were applied.',
    )
    expect(specializedToolMocks.setChatVar).not.toHaveBeenCalled()
  })

  it('bounds GraphMem traversal before embedding or searching', async () => {
    specializedToolMocks.graphMemory = JSON.stringify([{ name: 'Lantern', summary: 'Keep it lit.', connections: [] }])
    const client = new GraphMemClient()

    expect(
      text(
        await client.callTool('readMemory', { query: ['Lantern'], search_depth: GRAPH_MEMORY_MAX_SEARCH_DEPTH + 1 }),
      ),
    ).toContain(`between 1 and ${GRAPH_MEMORY_MAX_SEARCH_DEPTH}`)
    expect(specializedToolMocks.embedDocuments).not.toHaveBeenCalled()
    expect(specializedToolMocks.similaritySearch).not.toHaveBeenCalled()
  })
})
