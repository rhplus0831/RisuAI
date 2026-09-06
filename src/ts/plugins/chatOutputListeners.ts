import type { character, Chat } from '../storage/database.svelte'
import { safeStructuredClone } from '../safeStructuredClone'

export type ChatOutputListenerArg = {
  char: character
  chat: Chat
  characterIndex: number
  chatIndex: number
  messageIndex: number
  /** Stable across durable generation-effect lease reclaim. */
  effectIdempotencyKey?: string
}

export type ChatOutputListener = (arg: ChatOutputListenerArg) => void | Promise<void>

export const chatOutputListeners = new Set<ChatOutputListener>()
let runtimeReady = () => true

export function setChatOutputRuntimeReadyPredicate(predicate: () => boolean): void {
  runtimeReady = predicate
}

export function isChatOutputRuntimeReady(): boolean {
  return runtimeReady()
}

export function addChatOutputListener(mode: string, listener: ChatOutputListener): void {
  if (mode !== 'output') throw new Error(`chat listener mode ${mode} not found`)
  chatOutputListeners.add(listener)
}

export function removeChatOutputListener(mode: string, listener: ChatOutputListener): void {
  if (mode !== 'output') throw new Error(`chat listener mode ${mode} not found`)
  chatOutputListeners.delete(listener)
}

export async function runChatOutputListeners(arg: ChatOutputListenerArg): Promise<void> {
  if (!runtimeReady() || chatOutputListeners.size === 0) return

  const snapshot: ChatOutputListenerArg = {
    char: safeStructuredClone(arg.char),
    chat: safeStructuredClone(arg.chat),
    characterIndex: arg.characterIndex,
    chatIndex: arg.chatIndex,
    messageIndex: arg.messageIndex,
    ...(arg.effectIdempotencyKey ? { effectIdempotencyKey: arg.effectIdempotencyKey } : {}),
  }
  for (const listener of chatOutputListeners) {
    try {
      await listener(snapshot)
    } catch (error) {
      console.error(error)
    }
  }
}
