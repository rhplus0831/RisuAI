import type { character } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import { loadLoreBookV3Prompt } from '../lorebook.svelte'
import { risuChatParser } from '../scripts'

type LorebookV3Result = Awaited<ReturnType<typeof loadLoreBookV3Prompt>>
export type LoreActive = LorebookV3Result['actives'][number]

export interface UnformatedLorebookSlots {
  lorebook: OpenAIChat[]
  description: OpenAIChat[]
  postEverything: OpenAIChat[]
}

export interface LorebookContext {
  /** Substitutes `{{position::pt_<name>}}` markers (capped at 5 levels of nesting). */
  resolvePosition: (text: string) => string
  /**
   * Applies inject-mode lore at a named location, then resolves any
   * `{{position::...}}` markers. Used by the template walker and the
   * final render walker.
   */
  positionParser: (text: string, loc: string) => string
  /** Lore with `pos === 'depth'` (depth > 0) or `pos === 'reverse_depth'`. */
  depthPrompts: LoreActive[]
}

const positionRegex = /{{position::(.+?)}}/g

export async function buildLorebookContext(
  currentChar: character,
  unformated: UnformatedLorebookSlots,
): Promise<LorebookContext> {
  const lorepmt = await loadLoreBookV3Prompt()

  const replacePosition = (text: string): { text: string; replaced: boolean } => {
    let replaced = false
    const result = text.replace(positionRegex, (_match, p1) => {
      replaced = true
      const posMatch = 'pt_' + p1
      const matchingPrompts: string[] = []
      for (const v of lorepmt.actives) {
        if (v.pos === posMatch) {
          matchingPrompts.push(v.prompt)
        }
      }
      return matchingPrompts.join('\n')
    })
    return { text: result, replaced }
  }

  // maxDepth caps nested {{position::...}} resolution at 5 levels; any
  // unresolved markers after the loop are stripped.
  const resolvePosition = (text: string, maxDepth: number = 5): string => {
    let result = text
    for (let i = 0; i < maxDepth; i++) {
      const r = replacePosition(result)
      result = r.text
      if (!r.replaced) break
    }
    result = result.replace(positionRegex, '')
    return result
  }

  for (const lore of lorepmt.actives.filter((v) => v.pos === '' && v.inject === null)) {
    unformated.lorebook.push({
      role: lore.role,
      content: risuChatParser(resolvePosition(lore.prompt), { chara: currentChar }),
    })
  }

  for (const lore of lorepmt.actives.filter(
    (v) => v.pos === 'after_desc' || v.pos === 'before_desc' || v.pos === 'personality' || v.pos === 'scenario',
  )) {
    const chat: OpenAIChat = {
      role: lore.role,
      content: risuChatParser(resolvePosition(lore.prompt), { chara: currentChar }),
    }
    if (lore.pos === 'before_desc') {
      unformated.description.unshift(chat)
    } else {
      unformated.description.push(chat)
    }
  }

  for (const lore of lorepmt.actives.filter((v) => v.pos === 'depth' && v.depth === 0 && v.role !== 'assistant')) {
    unformated.postEverything.push({
      role: lore.role,
      content: risuChatParser(resolvePosition(lore.prompt), { chara: currentChar }),
    })
  }

  const injectionLorebooks = lorepmt.actives.filter((v) => v.inject && !v.inject.lore)
  const injectionLorePosSet = new Set<string>()
  for (const lore of injectionLorebooks) {
    injectionLorePosSet.add(lore.inject!.location)
  }

  // Assistant prefill lore lands at postEverything AFTER user/system lore so
  // the assistant prefill stays at the very end of the array.
  for (const lore of lorepmt.actives.filter((v) => v.pos === 'depth' && v.depth === 0 && v.role === 'assistant')) {
    unformated.postEverything.push({
      role: lore.role,
      content: risuChatParser(resolvePosition(lore.prompt), { chara: currentChar }),
    })
  }

  const positionParser = (text: string, loc: string): string => {
    if (injectionLorePosSet.has(loc)) {
      const matchings = injectionLorebooks.filter((v) => v.inject!.location === loc)
      for (const lore of matchings) {
        switch (lore.inject!.operation) {
          case 'append': {
            text += ' ' + lore.prompt
            break
          }
          case 'prepend': {
            text = lore.prompt + ' ' + text
            break
          }
          case 'replace': {
            text = text.replace(lore.inject!.param, lore.prompt)
            break
          }
        }
      }
    }

    return resolvePosition(text)
  }

  const depthPrompts = lorepmt.actives.filter((v) => (v.pos === 'depth' && v.depth > 0) || v.pos === 'reverse_depth')

  return { resolvePosition, positionParser, depthPrompts }
}
