import { getSelectedCharacterOwner } from '../characterState'
import {
  charactersResourceState,
  getCharacterResourceOwner,
  getChatMetadataOwnerState,
} from '../server/resourceState.svelte'
import { getChatMessageOwnerState } from '../server/chatMessageHydration.svelte'
import type { Chat, character, Message } from '../storage/database.svelte'

type ChatBranch = {
  children: Map<string, ChatBranch>
  maxChildren: number
  chatId: number
}

function search(left: string[], branch: ChatBranch, chatId: number) {
  if (left.length === 0) {
    return
  }

  const current = left[0]
  if (!branch.children.has(current)) {
    branch.children.set(current, {
      children: new Map(),
      maxChildren: 0,
      chatId: chatId,
    })
  }

  search(left.slice(1), branch.children.get(current)!, chatId)
}

function getMaxChildren(branch: ChatBranch) {
  let max = 0
  if (branch.children.size === 0) {
    return 1
  }

  for (const child of branch.children.values()) {
    max += getMaxChildren(child)
  }
  branch.maxChildren = max
  return max
}

type RenderedBranch = {
  x: number
  y: number
  connectX: number
  connectY: number
  content: string
  multiChild: boolean
  chatId: number
}

function renderBranch(branch: ChatBranch, x: number, y: number, connectX = -1, connectY = -1): RenderedBranch[] {
  const rendered: RenderedBranch[] = []
  for (const [key, child] of branch.children) {
    rendered.push({
      x,
      y,
      content: key,
      connectX,
      connectY,
      multiChild: branch.children.size > 1,
      chatId: child.chatId,
    })
    const childRendered = renderBranch(child, x, y + 1, x, y)
    rendered.push(...childRendered)
    x += child.maxChildren
  }
  return rendered
}

export function getChatBranches() {
  const character = selectedBranchCharacterOwner()
  if (!character) return []

  const mainBranch: ChatBranch = {
    children: new Map(),
    maxChildren: 0,
    chatId: -1,
  }

  let i = 0
  for (const candidate of character.chats) {
    const chat = candidate?.id ? uniqueBranchChatOwner(character, candidate.id) : undefined
    const messages = chat ? getChatMessageOwnerState(chat.id)?.messages : undefined
    if (!chat || !messages || !hasUniqueMessageOwners(messages)) return []

    const fm = chat.fmIndex === -1 ? character.firstMessage : character.alternateGreetings?.[chat.fmIndex ?? 0]
    const chatList: string[] = [simpleHasher(fm)]
    for (const message of messages) {
      chatList.push(simpleHasher(message.data))
    }

    search(chatList, mainBranch, i++)
  }

  getMaxChildren(mainBranch)

  return renderBranch(mainBranch, 0, 0)
}

function selectedBranchCharacterOwner(): character | undefined {
  if (charactersResourceState.status === 'ready') {
    const owner = getSelectedCharacterOwner()
    return owner?.chaId && getCharacterResourceOwner(owner.chaId) === owner ? owner : undefined
  }
  return undefined
}

function uniqueBranchChatOwner(character: character, chatId: string): Chat | undefined {
  if (!chatId) return undefined
  const matches = (character.chats ?? []).filter((candidate) => candidate?.id === chatId)
  if (matches.length !== 1) return undefined

  return getChatMetadataOwnerState(chatId) ? matches[0] : undefined
}

function hasUniqueMessageOwners(messages: readonly Message[]): boolean {
  const ids = new Set<string>()
  for (const message of messages) {
    const messageId = message?.chatId
    if (typeof messageId !== 'string' || !messageId.trim() || ids.has(messageId)) return false
    ids.add(messageId)
  }
  return true
}

function simpleHasher(str: string) {
  let hash = 0
  if (str.length == 0) return ''
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}
