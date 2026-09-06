export interface PlannedChatImportCreateRequest<TChat> {
  method: 'POST'
  path: string
  body: {
    chat: TChat
    select: boolean
  }
}

export interface PlannedChatImportTailRequest<TMessage> {
  method: 'POST'
  path: string
  body: {
    afterMessageId: string | null
    messages: TMessage[]
  }
  acceptedPrefixLength: number
}

export type PlannedChatImportRequest<TChat, TMessage> =
  | PlannedChatImportCreateRequest<TChat>
  | PlannedChatImportTailRequest<TMessage>

export interface ImportedChatRequestPlan<TChat, TMessage> {
  create: PlannedChatImportCreateRequest<TChat>
  tails: PlannedChatImportTailRequest<TMessage>[]
}

export function planImportedChatRequests<TChat, TMessage extends { chatId?: unknown }>(input: {
  characterId: string
  chatId: string
  fullChat: TChat
  metadataChat: TChat
  messages: readonly TMessage[]
  select: boolean
  maxPayloadBytes: number
  payloadByteLength: (request: PlannedChatImportRequest<TChat, TMessage>) => number
}): ImportedChatRequestPlan<TChat, TMessage> | null {
  const createPath = `/characters/${encodeURIComponent(input.characterId)}/chats`
  const create = (chat: TChat): PlannedChatImportCreateRequest<TChat> => ({
    method: 'POST',
    path: createPath,
    body: { chat, select: input.select },
  })
  const fullCreate = create(input.fullChat)
  if (input.payloadByteLength(fullCreate) <= input.maxPayloadBytes) {
    return { create: fullCreate, tails: [] }
  }

  const metadataCreate = create(input.metadataChat)
  if (input.payloadByteLength(metadataCreate) > input.maxPayloadBytes) return null
  if (input.messages.length === 0) return null

  const tailPath = `/chats/${encodeURIComponent(input.chatId)}/messages/tail`
  const tails: PlannedChatImportTailRequest<TMessage>[] = []
  let afterMessageId: string | null = null
  let acceptedPrefixLength = 0
  let pending: TMessage[] = []
  const tail = (anchor: string | null, messages: TMessage[]): PlannedChatImportTailRequest<TMessage> => ({
    method: 'POST',
    path: tailPath,
    body: { afterMessageId: anchor, messages },
    acceptedPrefixLength,
  })

  for (const message of input.messages) {
    const candidate = [...pending, message]
    if (input.payloadByteLength(tail(afterMessageId, candidate)) <= input.maxPayloadBytes) {
      pending = candidate
      continue
    }
    if (pending.length === 0) return null

    tails.push(tail(afterMessageId, pending))
    acceptedPrefixLength += pending.length
    const anchor = pending.at(-1)?.chatId
    if (typeof anchor !== 'string' || anchor.length === 0) return null
    afterMessageId = anchor
    pending = [message]
    if (input.payloadByteLength(tail(afterMessageId, pending)) > input.maxPayloadBytes) return null
  }

  if (pending.length > 0) tails.push(tail(afterMessageId, pending))
  return { create: metadataCreate, tails }
}
