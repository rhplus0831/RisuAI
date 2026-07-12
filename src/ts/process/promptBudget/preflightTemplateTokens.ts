import { getDatabase, type character } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import { parseChatML } from '../../parser/chatML'
import type { PromptItem } from '../prompt'
import { risuChatParser } from '../scripts'
import type { ChatTokenizer } from '../../tokenizer'
import { prebuiltAssetCommand } from '../../util'
import { systemizeChat } from '../promptAssembly/systemizeChat'

export interface PromptUnformatedSlots {
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

export interface PreflightResult {
  addedTokens: number
  memoryCardUsed: boolean
  hasCachePoint: boolean
}

export async function preflightTemplateTokens(
  promptTemplate: PromptItem[] | null,
  usingPromptTemplate: boolean,
  unformated: PromptUnformatedSlots,
  tokenizer: ChatTokenizer,
  currentChar: character,
  positionParser: (text: string, loc: string) => string,
): Promise<PreflightResult> {
  let addedTokens = 0
  let memoryCardUsed = false
  let hasCachePoint = false

  const tokenizeChatArray = async (chats: OpenAIChat[]) => {
    for (const chat of chats) {
      addedTokens += await tokenizer.tokenizeChat(chat)
    }
  }

  if (!promptTemplate) {
    for (const key in unformated) {
      const chats = unformated[key as keyof PromptUnformatedSlots]
      for (const chat of chats) {
        addedTokens += await tokenizer.tokenizeChat(chat)
      }
    }
    return { addedTokens, memoryCardUsed, hasCachePoint }
  }

  for (const card of promptTemplate) {
    switch (card.type) {
      case 'persona': {
        const pmt = safeStructuredClone(unformated.personaPrompt)
        if (card.innerFormat && pmt.length > 0) {
          for (let i = 0; i < pmt.length; i++) {
            pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
              chara: currentChar,
            }).replace('{{slot}}', pmt[i].content)
          }
        }
        await tokenizeChatArray(pmt)
        break
      }
      case 'description': {
        const pmt = safeStructuredClone(unformated.description)
        if (card.innerFormat && pmt.length > 0) {
          for (let i = 0; i < pmt.length; i++) {
            pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
              chara: currentChar,
            }).replace('{{slot}}', pmt[i].content)
          }
        }
        await tokenizeChatArray(pmt)
        break
      }
      case 'authornote': {
        const pmt = safeStructuredClone(unformated.authorNote)
        if (card.innerFormat && pmt.length > 0) {
          for (let i = 0; i < pmt.length; i++) {
            pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
              chara: currentChar,
            }).replace('{{slot}}', pmt[i].content || card.defaultText || '')
          }
        }
        await tokenizeChatArray(pmt)
        break
      }
      case 'lorebook': {
        await tokenizeChatArray(unformated.lorebook)
        break
      }
      case 'postEverything': {
        await tokenizeChatArray(unformated.postEverything)
        if (usingPromptTemplate && getDatabase().promptSettings.postEndInnerFormat) {
          await tokenizeChatArray([
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

        await tokenizeChatArray([prompt])
        break
      }
      case 'chatML': {
        const prompts = parseChatML(card.text)
        await tokenizeChatArray(prompts ?? [])
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
        await tokenizeChatArray(chats)
        break
      }
      case 'memory': {
        memoryCardUsed = true
        break
      }
      case 'cache': {
        hasCachePoint = true
        break
      }
    }
  }

  return { addedTokens, memoryCardUsed, hasCachePoint }
}
