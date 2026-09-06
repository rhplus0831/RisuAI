import { cloneMCPTools, MCPClientLike } from './internalmcp'
import type { MCPTool, RPCToolCallContent } from './mcplib'

const DICE_TOOLS: MCPTool[] = [
  {
    name: 'rollDice',
    description: 'Roll dice based on the given notation.',
    inputSchema: {
      type: 'object',
      properties: {
        notation: {
          type: 'string',
          description: 'The dice notation to roll, e.g., "2d6+3".',
        },
      },
      required: ['notation'],
    },
  },
]

export const DICE_MAX_COUNT = 100
export const DICE_MAX_SIDES = 1_000_000

export class DiceClient extends MCPClientLike {
  constructor() {
    super('internal:dice')
    this.serverInfo.serverInfo.name = 'Dice'
    this.serverInfo.serverInfo.version = '1.0.0'
    this.serverInfo.instructions = "A tool to roll dice in various formats. like '2d6+3' or 'd20'."
  }
  async getToolList() {
    return cloneMCPTools(DICE_TOOLS)
  }
  async callTool(toolName: string, args: any): Promise<RPCToolCallContent[]> {
    if (toolName === 'rollDice') {
      const notation = typeof args?.notation === 'string' ? args.notation.trim() : ''
      try {
        const result = rollDice(notation)
        return [
          {
            type: 'text',
            text: `Rolled ${notation}: ${result.total} (Details: ${result.details})`,
          },
        ]
      } catch (error) {
        return [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Invalid dice notation.'}`,
          },
        ]
      }
    }
    throw new Error(`Unknown tool: ${toolName}`)
  }
}

function rollDice(notation: string): { total: number; details: string } {
  if (!notation) throw new Error('Dice notation must be a non-empty string.')

  const dicePattern = /(\d*)d(\d+)([+-]\d+)?/g
  let match
  let lastMatchEnd = 0
  let total = 0
  let details = []
  while ((match = dicePattern.exec(notation)) !== null) {
    if (!/^[\s,;]*$/.test(notation.slice(lastMatchEnd, match.index))) {
      throw new Error(`Invalid dice notation: ${notation}`)
    }
    const count = match[1] === '' ? 1 : Number.parseInt(match[1], 10)
    const sides = Number.parseInt(match[2], 10)
    const modifier = match[3] ? Number.parseInt(match[3], 10) : 0
    if (!Number.isSafeInteger(count) || count < 1 || count > DICE_MAX_COUNT) {
      throw new Error(`Dice count must be between 1 and ${DICE_MAX_COUNT}.`)
    }
    if (!Number.isSafeInteger(sides) || sides < 1 || sides > DICE_MAX_SIDES) {
      throw new Error(`Dice sides must be between 1 and ${DICE_MAX_SIDES}.`)
    }
    if (!Number.isSafeInteger(modifier)) {
      throw new Error('Dice modifier must be a safe integer.')
    }
    let rollTotal = 0
    let rolls = []
    for (let i = 0; i < count; i++) {
      const roll = Math.floor(Math.random() * sides) + 1
      rolls.push(roll)
      rollTotal += roll
    }
    rollTotal += modifier
    total += rollTotal
    details.push(
      `${count}d${sides}${modifier ? match[3] : ''}: [${rolls.join(', ')}]${modifier ? ` ${match[3]}` : ''} = ${rollTotal}`,
    )
    lastMatchEnd = dicePattern.lastIndex
  }
  if (details.length === 0 || !/^[\s,;]*$/.test(notation.slice(lastMatchEnd))) {
    throw new Error(`Invalid dice notation: ${notation}`)
  }
  return { total, details: details.join('; ') }
}
