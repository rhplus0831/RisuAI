export interface PromptTokenSource {
  mainPrompt: string
  jailbreak: string
  globalNote: string
}

export interface PromptTokenCounts {
  mainPrompt: number
  jailbreak: number
  globalNote: number
}

export function createLatestPromptTokenCounter(
  tokenize: (text: string) => Promise<number>,
): (source: PromptTokenSource) => Promise<PromptTokenCounts | null> {
  let latestOperation = 0

  return async (source: PromptTokenSource): Promise<PromptTokenCounts | null> => {
    const operation = ++latestOperation
    const mainPrompt = await tokenize(source.mainPrompt)
    if (operation !== latestOperation) return null

    const jailbreak = await tokenize(source.jailbreak)
    if (operation !== latestOperation) return null

    const globalNote = await tokenize(source.globalNote)
    if (operation !== latestOperation) return null

    return { mainPrompt, jailbreak, globalNote }
  }
}
