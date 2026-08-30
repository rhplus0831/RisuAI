import type { FastifyChat as Chat, FastifyCharacter as character, FastifyDatabase as Database } from './serverTypes.js'
import { getActiveModules, getModuleAssets } from './modules.js'

export type PromptAssetEntry = readonly [string, string, string]
export type PromptAssetTable = readonly PromptAssetEntry[]

export interface PromptAssetTableInstrumentation {
  builds: number
}

const promptAssetTableInstrumentation: PromptAssetTableInstrumentation = {
  builds: 0,
}

export function resetPromptAssetTableInstrumentation(): void {
  promptAssetTableInstrumentation.builds = 0
}

export function getPromptAssetTableInstrumentation(): PromptAssetTableInstrumentation {
  return { ...promptAssetTableInstrumentation }
}

export function buildPromptAssetTable(args: {
  database: Database
  currentChar: character
  currentChat: Chat
}): PromptAssetEntry[] {
  promptAssetTableInstrumentation.builds++
  return (args.currentChar.additionalAssets ?? []).concat(
    getModuleAssets(getActiveModules(args.database, args.currentChar, args.currentChat)),
  )
}
