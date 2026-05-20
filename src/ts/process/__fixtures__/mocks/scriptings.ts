import type { OpenAIChat } from '../../index.svelte'

/**
 * Fake runLuaEditTrigger. The real impl loads each `triggerscript` entry's
 * Lua code into wasmoon and executes it. Here we sidestep wasmoon and
 * apply a deterministic mutation when the character has at least one
 * triggerscript entry:
 *   - mode 'editRequest' on OpenAIChat[]: append a marker system message
 *     to the array so fixtures can verify the integration point fires.
 *   - any other mode (or empty triggerscript): pass-through.
 *
 * processScriptFull also calls runLuaEditTrigger with string content during
 * 'editoutput' / 'editinput' / 'editdisplay'; we leave strings unchanged so
 * the customscript regex pipeline is the only thing mutating responses.
 */
export async function runLuaEditTrigger<T extends string | OpenAIChat[]>(
  char: { triggerscript?: unknown[] } | { type: 'simple' },
  mode: string,
  content: T,
  _meta?: object,
): Promise<T> {
  const triggers = 'triggerscript' in char ? (char.triggerscript ?? []) : []
  if (triggers.length === 0) return content

  if (mode === 'editRequest' && Array.isArray(content)) {
    const marker: OpenAIChat = {
      role: 'system',
      content: '[edit-request marker]',
      memo: 'edit-request-marker',
    }
    return [...content, marker] as T
  }
  return content
}

/**
 * Stub for runScripted (used by triggers.ts). The real impl loads wasmoon
 * which fails to initialize in vitest because its createRequire call
 * receives a non-file URL. Triggers don't fire in any current fixture
 * (none have non-empty triggerscript that runTrigger would dispatch), so
 * returning a no-op result is enough.
 */
export async function runScripted(
  _code: string,
  args: { char?: unknown; chat?: unknown; mode?: string; data?: unknown; [k: string]: unknown },
) {
  // The real triggers.ts pulls `chat` and `stopSending` off the result and
  // assigns them back; missing fields would leave `chat = undefined` and
  // crash downstream makeMs(). Echo the inputs through unchanged.
  return {
    res: undefined,
    stopSending: false,
    additonalSysPrompt: undefined,
    chat: args.chat,
  }
}

export async function runLuaButtonTrigger() {
  return undefined
}
