import { getChatVar, setChatVar } from 'src/ts/parser/chatVar.svelte'
import { cloneMCPTools, MCPClientLike } from './internalmcp'
import type { MCPTool, RPCToolCallContent } from './mcplib'
import { HypaProcesser } from '../memory/hypamemory'

type GraphIndex = {
  name: string
  summary: string
  connections: string[]
}

const GRAPH_MEMORY_TOOLS: MCPTool[] = [
  {
    name: 'writeMemory',
    description: 'Write a memory entry to the graph database.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the memory entry.',
        },
        summary: {
          type: 'string',
          description: 'A brief summary of the memory entry.',
        },
        connections: {
          type: 'array',
          items: {
            type: 'string',
            description: 'Names of related memory entries.',
          },
          description: 'Connections to other memory entries.',
        },
      },
      required: ['name', 'summary'],
    },
  },
  {
    name: 'readMemory',
    description: 'Read a memory entry from the graph database.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'The query terms to search for memory entries.',
        },
        search_depth: {
          type: 'number',
          description: 'The depth of connections to explore in the graph. default is 2.',
          minimum: 1,
          maximum: 8,
        },
      },
      required: ['query'],
    },
  },
]

export const GRAPH_MEMORY_MAX_SEARCH_DEPTH = 8

function isGraphIndex(value: unknown): value is GraphIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<GraphIndex>
  return (
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.connections) &&
    candidate.connections.every((connection) => typeof connection === 'string')
  )
}

function readGraphMemory(): GraphIndex[] {
  const raw = getChatVar('graphmem_graph')
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Stored graph memory is malformed; no changes were applied.')
  }
  if (!Array.isArray(parsed) || !parsed.every(isGraphIndex)) {
    throw new Error('Stored graph memory has an invalid shape; no changes were applied.')
  }
  return parsed
}

export class GraphMemClient extends MCPClientLike {
  constructor() {
    super('internal:graphmem')
    this.serverInfo.serverInfo.name = 'GraphMem'
    this.serverInfo.serverInfo.version = '1.0.0'
    this.serverInfo.instructions = 'Memory management using graph database.'
  }

  async getToolList(): Promise<MCPTool[]> {
    return cloneMCPTools(GRAPH_MEMORY_TOOLS)
  }

  async callTool(toolName: string, args: any): Promise<RPCToolCallContent[]> {
    try {
      switch (toolName) {
        case 'writeMemory': {
          return await this.handleWriteMemory(args)
        }
        case 'readMemory': {
          return await this.handleReadMemory(args)
        }
        default:
          return [{ type: 'text', text: `Unknown tool: ${toolName}` }]
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      return [{ type: 'text', text: `Error: ${errorMessage}` }]
    }
  }

  private async handleWriteMemory(args: any): Promise<RPCToolCallContent[]> {
    const name = typeof args?.name === 'string' ? args.name.trim() : ''
    const summary = typeof args?.summary === 'string' ? args.summary : ''
    const connections = args?.connections ?? []
    if (!name || typeof args?.summary !== 'string') {
      throw new Error('Memory name and summary must be strings, and name must not be empty.')
    }
    if (!Array.isArray(connections) || !connections.every((connection) => typeof connection === 'string')) {
      throw new Error('Memory connections must be an array of strings.')
    }

    const graph = readGraphMemory()

    graph.push({ name, summary, connections })

    setChatVar('graphmem_graph', JSON.stringify(graph))
    return [{ type: 'text', text: `Memory entry "${name}" written successfully.` }]
  }

  private async handleReadMemory(args: any): Promise<RPCToolCallContent[]> {
    const {
      query,
      search_depth = 2,
    }: {
      query: string[]
      search_depth?: number
      threshold?: number
    } = args

    if (!Array.isArray(query) || query.length === 0 || !query.every((term) => typeof term === 'string' && term)) {
      return [{ type: 'text', text: `Query must be a non-empty array of strings.` }]
    }
    if (!Number.isInteger(search_depth) || search_depth < 1 || search_depth > GRAPH_MEMORY_MAX_SEARCH_DEPTH) {
      return [
        {
          type: 'text',
          text: `Search depth must be an integer between 1 and ${GRAPH_MEMORY_MAX_SEARCH_DEPTH}.`,
        },
      ]
    }

    const graph = readGraphMemory()

    if (!Array.isArray(graph) || graph.length === 0) {
      return [{ type: 'text', text: `No memory entries found in the graph database.` }]
    }

    const processer = new HypaProcesser()
    await processer.embedDocuments(graph.map((g) => g.name))

    let results: {
      queryTerm: string
      entries: GraphIndex[]
    }[] = []
    for (let i = 0; i < query.length; i++) {
      let currentEntries: GraphIndex[] = []
      let toSearch: string[] = [query[i]]
      for (let depth = 0; depth < search_depth; depth++) {
        const newEntries: GraphIndex[] = []
        for (const searchTerm of toSearch) {
          const searched = await processer.similaritySearch(searchTerm)
          for (const entry of searched) {
            const found = graph.find((g) => g.name === entry)
            if (found && !currentEntries.includes(found)) {
              newEntries.push(found)
            }
          }
        }
        currentEntries = currentEntries.concat(newEntries)
        toSearch = newEntries.flatMap((e) => e.connections)
      }

      results.push({ queryTerm: query[i], entries: currentEntries })
    }

    return [{ type: 'text', text: JSON.stringify(results, null, 2) }]
  }
}
