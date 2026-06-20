import { getDatabase } from '../../storage/database.svelte'
import type { character, Chat, Database, triggerscript } from '../../storage/database.svelte'
import { LLMFlags } from '../../model/types'
import { getModuleTriggers } from '../modules'
import { pluginV2 } from '../../plugins/plugins.svelte'
import { composeEffectivePresetSettings } from '../../presetSplit'
import {
  modelProfileGenerationBlockReason,
  resolveModelProfile,
  type ResolvedModelProfile,
} from '../../model/modelProfileResolver'

/**
 * Three-arm verdict for the `sendChat` prompt-assembly gate, mirroring
 * `ServerCompletionRoute` (`serverCompletion.ts:13`). `local` is bare — assembly
 * does not pick a provider; dispatch does. `server` is likewise bare. `unsupported`
 * carries the user-facing failure message surfaced by the gate.
 */
export type ServerPromptAssemblyRoute = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export interface ServerPromptAssemblyInput {
  currentChar: character
  currentChat: Chat
  preview?: boolean
  previewPrompt?: boolean
  continue?: boolean
  regenerateMessageId?: string
}

type ServerPromptAssemblyMode = 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'

/** Mirrors `serverChatMode` (`serverBackedSendChat.ts:84-95`). */
function deriveMode(input: ServerPromptAssemblyInput): ServerPromptAssemblyMode {
  if (input.previewPrompt) return 'preview_prompt'
  if (input.preview) return 'preview'
  if (typeof input.regenerateMessageId === 'string') return 'regenerate'
  if (input.continue) return 'continue'
  return 'send'
}

// Inlay / asset markers the local converter resolves into image/asset bytes
// (`formatHistoryMessage.ts:76,85,154`). The server assembler resolves them too:
// inlay and asset bytes come from the server store. Legacy inlay ids can ride
// the request as id aliases, but never as base64 bytes. Only the non-vision
// caption case below remains unsupported.
const INLAY_MARKER = /\{\{(?:inlay|inlayed|inlayeddata)::/i
const ASSET_MARKER = /\{\{asset_?prompt::/i

/**
 * Multimodal / asset content: any message carrying a runtime `multimodals` array
 * (set by scripting at `scriptings.ts:563,938`) or an inlay/asset marker in its
 * `.data`. Used to detect the non-vision caption fallback case.
 */
function sendHasMultimodalOrAsset(currentChat: Chat): boolean {
  for (const message of currentChat.message ?? []) {
    const multimodals = (message as { multimodals?: unknown }).multimodals
    if (Array.isArray(multimodals) && multimodals.length > 0) return true
    const data = message.data
    if (typeof data === 'string' && (INLAY_MARKER.test(data) || ASSET_MARKER.test(data))) {
      return true
    }
  }
  return false
}

/** Whether the active resolved profile accepts inline image input. */
function modelAcceptsImageInput(input: ServerPromptAssemblyInput): boolean {
  return resolveProfileForChat(input.currentChat).modelInfo.flags.includes(LLMFlags.hasImageInput)
}

// Interactive Lua dialog APIs. A `triggerlua` script that calls one of these
// mid-assembly needs a browser dialog the server cannot drive (the server VM
// throws an InteractiveApiError, `luaRuntime.ts`). Handlers register at runtime
// via `listenEdit`, so the mode a script hooks is not statically knowable — but a
// script that never names these tokens cannot invoke them, so a source scan is a
// sound conservative gate (false positives keep a send in the browser; never a
// hard fail).
const INTERACTIVE_LUA_API_RE = /\b(?:alertInput|alertSelect|alertConfirm)\b/

/** Whether any `triggerlua` effect's source references an interactive dialog API. */
function triggersUseInteractiveLua(triggers: triggerscript[] | undefined): boolean {
  if (!Array.isArray(triggers)) return false
  return triggers.some((trigger) => {
    const effect = trigger?.effect?.[0]
    return (
      effect?.type === 'triggerlua' &&
      typeof (effect as { code?: unknown }).code === 'string' &&
      INTERACTIVE_LUA_API_RE.test((effect as { code: string }).code)
    )
  })
}

/**
 * pluginV2 edit hooks (local-assembler class 5, plugin arm): any registered
 * pluginV2 edit/replacer function. **Permanent `unsupported`** because pluginV2
 * code does not execute server-side and is superseded by Plugin V3. This detector
 * never flips to `server`; the client-thinning invariant keeps a server-side
 * execution path from being silently added.
 */
function hasPluginV2EditSet(): boolean {
  return (
    pluginV2.editinput.size > 0 ||
    pluginV2.editoutput.size > 0 ||
    pluginV2.editprocess.size > 0 ||
    pluginV2.editdisplay.size > 0 ||
    pluginV2.replacerbeforeRequest.size > 0 ||
    pluginV2.replacerafterRequest.size > 0
  )
}

/**
 * Lua script content: a `triggerlua` effect on the character or any enabled
 * module. The server Lua VM runs non-interactive hooks, so only scripts that
 * reference browser dialog APIs (`alertInput`/`alertSelect`/`alertConfirm`) stay
 * `unsupported`.
 * Kept separate from `hasPluginV2EditSet` so the permanent pluginV2 hard-fail is
 * undisturbed.
 */
function luaUsesInteractiveApi(currentChar: character): boolean {
  return triggersUseInteractiveLua(currentChar.triggerscript) || triggersUseInteractiveLua(getModuleTriggers())
}

/**
 * True if the send carries content the server `/chat` assembler cannot reproduce.
 * Coarse presence detection: on doubt, report content as `unsupported`, never
 * silently fall through to a server assembly that would drop it.
 */
function sendHasUnsupportedContent(input: ServerPromptAssemblyInput): string | null {
  // When the model lacks image input, the local assembler replaces an image with
  // a `runImageEmbedding` caption
  // (`formatHistoryMessage.ts:111-114`) — a browser-only ML pipeline with no
  // server equivalent. Rather than emit a silently captionless prompt, any
  // image/asset/inlay content on a non-vision model is `unsupported`.
  if (sendHasMultimodalOrAsset(input.currentChat) && !modelAcceptsImageInput(input)) {
    return 'This model has no image input, so image/asset content would need the browser caption fallback, which server prompt assembly cannot reproduce. Select a vision-capable server-routed model before retrying.'
  }
  // Image-gen / emotion view instructions are server-assembled. The post-gen
  // image generation / inlay-screen rendering stays a browser effect.
  // Lua scripts route to the server unless they reference an interactive dialog
  // API the server cannot drive.
  if (luaUsesInteractiveApi(input.currentChar)) {
    return 'Lua scripts using interactive dialogs (alertInput / alertSelect / alertConfirm) require the browser and are not supported by server prompt assembly.'
  }
  // pluginV2 edit hooks stay permanently `unsupported` (no-port list; deprecated
  // by Plugin V3). Reported separately from Lua; see `hasPluginV2EditSet`.
  if (hasPluginV2EditSet()) {
    return 'Plugin (V2) scripts run only in the browser plugin runtime and are not supported by server prompt assembly.'
  }
  return null
}

function effectiveModelDatabaseForChat(currentChat: Chat): Database {
  const db = getDatabase()
  const settings = currentChat.generationSettings
  const modelPreset = findPresetById(db.modelPresets, settings?.modelPresetId)
  const promptPreset = findPresetById(db.promptPresets, settings?.promptPresetId)
  return composeEffectivePresetSettings({
    base: db as unknown as Record<string, unknown>,
    modelPreset,
    promptPreset,
    scope: 'model-runtime',
  }) as unknown as Database
}

function findPresetById(collection: unknown, id: string | undefined): Record<string, unknown> | undefined {
  if (!id || !Array.isArray(collection)) return undefined
  return collection.find((item): item is Record<string, unknown> => {
    return !!item && typeof item === 'object' && !Array.isArray(item) && (item as { id?: unknown }).id === id
  })
}

function resolveProfileForChat(currentChat: Chat): ResolvedModelProfile {
  return resolveModelProfile({ database: effectiveModelDatabaseForChat(currentChat) })
}

function unsupportedServerGenerationReason(aiModel: string): string {
  return `Generation for ${aiModel} is not supported in Fastify server mode. Select a server-routed provider or change this model before retrying.`
}

function resolveServerProviderPreflight(currentChat: Chat): ServerPromptAssemblyRoute | null {
  const profile = resolveProfileForChat(currentChat)
  const profileBlockReason = modelProfileGenerationBlockReason(profile)
  if (profileBlockReason) {
    return {
      type: 'unsupported',
      reason: profileBlockReason,
    }
  }
  if (profile.modelInfo.unsupportedReason) {
    return {
      type: 'unsupported',
      reason: profile.modelInfo.unsupportedReason,
    }
  }
  if (profile.providerCapability.routable) return null
  return {
    type: 'unsupported',
    reason: unsupportedServerGenerationReason(profile.modelId),
  }
}

/**
 * Decide whether `sendChat` must assemble its prompt on the server, hard-fail, or
 * fall back to the in-browser assembler. The completion adapter no longer builds
 * provider wire payloads, but prompt assembly still performs this provider
 * preflight so unsupported Fastify sends fail before mutating chat state.
 *
 * Decision order:
 *   1. mode / user-message structural check (subsumes the old, silently-falling
 *      `canUseServerAssembly` at `serverBackedSendChat.ts:142`).
 *   2. single, non-group character.
 *   3. server-routable provider (shared provider-capability table).
 *   4. no interactive-Lua / pluginV2 content, and no image/asset/inlay content
 *      on a model without image input. Vision-model image/asset/inlay content,
 *      image-gen / emotion view instructions, and non-interactive Lua hooks are
 *      server-assembled; pluginV2 edit hooks stay a permanent hard fail.
 *   5. otherwise → `server`.
 *
 * The verdict is always `server` or `unsupported` — never a silent local
 * fall-through.
 */
export function resolveServerPromptAssembly(input: ServerPromptAssemblyInput): ServerPromptAssemblyRoute {
  const mode = deriveMode(input)
  if (mode === 'send') {
    const lastMessage = input.currentChat.message.at(-1)
    if (lastMessage?.role !== 'user' || typeof lastMessage.data !== 'string') {
      return {
        type: 'unsupported',
        reason: 'Server prompt assembly for a send requires the last message to be a text user message.',
      }
    }
  }

  // Group chat is legacy (filtered at load in `database.svelte.ts`, and
  // `isGroupChat` is hardcoded false) but the flag's JSDoc still lists it as a
  // non-parity item — surface it explicitly instead of trusting the filter.
  if ((input.currentChar as { type?: string }).type === 'group') {
    return {
      type: 'unsupported',
      reason: 'Group chats are not supported by server prompt assembly.',
    }
  }

  const providerReason = resolveServerProviderPreflight(input.currentChat)
  if (providerReason !== null) return providerReason

  const contentReason = sendHasUnsupportedContent(input)
  if (contentReason !== null) {
    return { type: 'unsupported', reason: contentReason }
  }

  return { type: 'server' }
}
