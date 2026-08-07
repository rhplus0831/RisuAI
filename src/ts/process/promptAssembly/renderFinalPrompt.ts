import { parseChatML } from '../../parser/chatML'
import { prebuiltAssetCommand } from '../../util'
import { getDatabase, type character } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import type { PromptItem } from '../prompt'
import { applyDescriptionPromptRole, applyPromptBlockRole } from '../promptBlockRole'
import { risuChatParser } from '../scripts'
import { runLuaEditTrigger } from '../scriptings'
import { systemizeChat } from './systemizeChat'

export interface UnformatedPromptSlots {
  main: OpenAIChat[]
  jailbreak: OpenAIChat[]
  chats: OpenAIChat[]
  lorebook: OpenAIChat[]
  globalNote: OpenAIChat[]
  authorNote: OpenAIChat[]
  lastChat: OpenAIChat[]
  description: OpenAIChat[]
  postEverything: OpenAIChat[]
  personaPrompt: OpenAIChat[]
}

export type FormatOrderKey = keyof UnformatedPromptSlots

export interface RenderFinalPromptArgs {
  currentChar: character
  unformated: UnformatedPromptSlots
  promptTemplate: PromptItem[] | null
  usingPromptTemplate: boolean
  /** Cloned + `postEverything`-appended client-database formatting order. Used only on the non-template path. */
  formatOrder: FormatOrderKey[]
  /** Memory rows captured by `buildMemoryWindow` for the `'memory'` template card. */
  memories: OpenAIChat[]
  /** Returned by `buildLorebookContext`. Substitutes `{{position::pt_<name>}}` markers inside `innerFormat` / plain text. */
  positionParser: (text: string, loc: string) => string
  /** From `preflightTemplateTokens`. When true, suppresses the automatic 3-deep `user` cache-point walk-back. */
  hasCachePoint: boolean
  /** `arg.continue` from sendChat. Pushes a `[Continue the last response]` system entry under gpt/claude/openrouter/reverse_proxy. */
  isContinue: boolean
  /** Index of the base character-description row after lorebook placement. */
  descriptionBaseIndex?: number
}

export interface RenderFinalPromptResult {
  formated: OpenAIChat[]
  /** Defined only when both `promptInfoInsideChat` and `promptTextInfoInsideChat` are enabled. */
  promptText?: OpenAIChat[]
}

/**
 * Render the final OpenAI-shaped prompt array from the assembled `unformated`
 * slots. Walks the prompt template (or `formatingOrder` when there is no
 * template), applies the automatic cache-point walk-back, splices the
 * character `depth_prompt`, and runs the `editRequest` Lua trigger. Also
 * captures the per-card `innerFormat` / plain content into a parallel
 * `promptText` array when prompt-info text capture is enabled.
 *
 * Mutates `args.unformated.postEverything` with the `[Continue the last response]`
 * marker when `isContinue && aiModel ∈ {gpt, claude, openrouter, reverse_proxy}`.
 */
export async function renderFinalPrompt(args: RenderFinalPromptArgs): Promise<RenderFinalPromptResult> {
  const {
    currentChar,
    unformated,
    promptTemplate,
    usingPromptTemplate,
    formatOrder,
    memories,
    positionParser,
    hasCachePoint,
    isContinue,
    descriptionBaseIndex,
  } = args

  let formated: OpenAIChat[] = []

  if (
    isContinue &&
    (getDatabase().aiModel.startsWith('claude') ||
      getDatabase().aiModel.startsWith('gpt') ||
      getDatabase().aiModel.startsWith('openrouter') ||
      getDatabase().aiModel.startsWith('reverse_proxy'))
  ) {
    unformated.postEverything.push({
      role: 'system',
      content: '[Continue the last response]',
    })
  }

  function pushPrompts(cha: OpenAIChat[]) {
    for (const chat of cha) {
      if (!chat.content.trim() && !(chat.multimodals && chat.multimodals.length > 0)) {
        continue
      }
      if (
        !(
          getDatabase().aiModel.startsWith('gpt') ||
          getDatabase().aiModel.startsWith('claude') ||
          getDatabase().aiModel === 'openrouter' ||
          getDatabase().aiModel === 'reverse_proxy'
        )
      ) {
        formated.push(chat)
        continue
      }
      if (chat.role === 'system') {
        const endf = formated.at(-1)
        if (endf && endf.role === 'system' && endf.memo === chat.memo && endf.name === chat.name) {
          formated[formated.length - 1].content += '\n\n' + chat.content
        } else {
          formated.push(chat)
        }
        formated.at(-1).content += ''
      } else {
        formated.push(chat)
      }
    }
  }

  let promptBodyformatedForChatStore: OpenAIChat[] = []
  function pushPromptInfoBody(
    role: 'function' | 'system' | 'user' | 'assistant',
    fmt: string,
    promptBody: OpenAIChat[],
  ) {
    if (!fmt.trim()) {
      return
    }
    promptBody.push({
      role: role,
      content: risuChatParser(fmt),
    })
  }

  if (promptTemplate) {
    const template = promptTemplate

    for (const card of template) {
      switch (card.type) {
        case 'persona': {
          let pmt = applyPromptBlockRole(safeStructuredClone(unformated.personaPrompt), card.role2)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content)

              if (getDatabase().promptInfoInsideChat && getDatabase().promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'description': {
          let pmt = applyDescriptionPromptRole(
            safeStructuredClone(unformated.description),
            card.role2,
            descriptionBaseIndex,
          )
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content)

              if (getDatabase().promptInfoInsideChat && getDatabase().promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'authornote': {
          let pmt = applyPromptBlockRole(safeStructuredClone(unformated.authorNote), card.role2)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content || card.defaultText || '')

              if (getDatabase().promptInfoInsideChat && getDatabase().promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'lorebook': {
          pushPrompts(unformated.lorebook)
          break
        }
        case 'postEverything': {
          pushPrompts(unformated.postEverything)
          if (usingPromptTemplate && getDatabase().promptSettings.postEndInnerFormat) {
            pushPrompts([
              {
                role: 'system',
                content: getDatabase().promptSettings.postEndInnerFormat,
              },
            ])
          }
          break
        }
        case 'plain':
        case 'jailbreak':
        case 'cot': {
          if (!getDatabase().jailbreakToggle && card.type === 'jailbreak') {
            continue
          }
          if (!getDatabase().chainOfThought && card.type === 'cot') {
            continue
          }

          const convertRole = {
            system: 'system',
            user: 'user',
            bot: 'assistant',
          } as const

          const posType = card.type === 'plain' ? card.type2 : card.type
          let content = positionParser(card.text, posType)

          if (card.type2 === 'globalNote') {
            if (currentChar.replaceGlobalNote) {
              content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll('{{original}}', content)
            }
            if (currentChar.prebuiltAssetCommand && !card.text.includes('{{//@customimageinstruction}}')) {
              content += prebuiltAssetCommand
            }
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          } else if (card.type2 === 'main') {
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          } else {
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          }

          const prompt: OpenAIChat = {
            role: convertRole[card.role],
            content: content,
          }

          if (
            getDatabase().promptInfoInsideChat &&
            getDatabase().promptTextInfoInsideChat &&
            card.type2 !== 'globalNote'
          ) {
            pushPromptInfoBody(prompt.role, prompt.content, promptBodyformatedForChatStore)
          }

          pushPrompts([prompt])
          break
        }
        case 'chatML': {
          let prompts = parseChatML(card.text)
          pushPrompts(prompts)
          break
        }
        case 'chat': {
          let start = card.rangeStart
          let end = card.rangeEnd === 'end' ? unformated.chats.length : card.rangeEnd
          if (start === -1000) {
            start = 0
            end = unformated.chats.length
          }
          if (start < 0) {
            start = unformated.chats.length + start
            if (start < 0) {
              start = 0
            }
          }
          if (end < 0) {
            end = unformated.chats.length + end
            if (end < 0) {
              end = 0
            }
          }

          if (start >= end) {
            break
          }

          let chats = unformated.chats.slice(start, end)
          if (usingPromptTemplate && getDatabase().promptSettings.sendChatAsSystem && !card.chatAsOriginalOnSystem) {
            chats = systemizeChat(chats)
          }
          pushPrompts(chats)

          if (getDatabase().automaticCachePoint && !hasCachePoint) {
            let pointer = formated.length - 1
            let depthRemaining = 3
            while (pointer >= 0) {
              if (depthRemaining === 0) {
                break
              }
              if (formated[pointer].role === 'user') {
                formated[pointer].cachePoint = true
                depthRemaining--
              }
              pointer--
            }
          }
          break
        }
        case 'memory': {
          let pmt = applyPromptBlockRole(safeStructuredClone(memories), card.role2)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(card.innerFormat, { chara: currentChar }).replace(
                '{{slot}}',
                pmt[i].content,
              )

              if (getDatabase().promptInfoInsideChat && getDatabase().promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'cache': {
          let pointer = formated.length - 1
          let depthRemaining = card.depth
          while (pointer >= 0) {
            if (depthRemaining === 0) {
              break
            }
            if (formated[pointer].role === card.role || card.role === 'all') {
              formated[pointer].cachePoint = true
              depthRemaining--
            }
            pointer--
          }
          break
        }
      }
    }
  } else {
    for (let i = 0; i < formatOrder.length; i++) {
      const cha = unformated[formatOrder[i]]
      pushPrompts(cha)
    }
  }

  formated = formated.map((v) => {
    v.content = v.content.trim()
    return v
  })

  const captureInfo = getDatabase().promptInfoInsideChat && getDatabase().promptTextInfoInsideChat
  if (captureInfo) {
    promptBodyformatedForChatStore = promptBodyformatedForChatStore.map((v) => {
      v.content = v.content.trim()
      return v
    })
  }

  if (currentChar.depth_prompt && currentChar.depth_prompt.prompt && currentChar.depth_prompt.prompt.length > 0) {
    const depthPrompt = currentChar.depth_prompt
    formated.splice(formated.length - depthPrompt.depth, 0, {
      role: 'system',
      content: risuChatParser(depthPrompt.prompt, { chara: currentChar }),
    })
  }

  formated = await runLuaEditTrigger(currentChar, 'editRequest', formated)

  let promptText: OpenAIChat[] | undefined
  if (captureInfo) {
    promptBodyformatedForChatStore = await runLuaEditTrigger(currentChar, 'editRequest', promptBodyformatedForChatStore)
    promptText = promptBodyformatedForChatStore
  }

  return { formated, promptText }
}
