import { isFastifyServer } from '../../platform'
import { getDatabase } from '../../storage/database.svelte'
import type { character, Chat, triggerscript } from '../../storage/database.svelte'
import { getModelInfo, LLMFlags } from '../../model/modellist'
import { getModuleTriggers } from '../modules'
import { pluginV2 } from '../../plugins/plugins.svelte'
import { resolveServerCompletionRoute } from './serverCompletion'
import type { RequestDataArgumentExtended } from './request'

/**
 * Three-arm verdict for the `sendChat` prompt-assembly gate, mirroring
 * `ServerCompletionRoute` (`serverCompletion.ts:13`). `local` is bare — assembly
 * does not pick a provider; dispatch does. `server` is likewise bare. `unsupported`
 * carries the user-facing failure message surfaced by the gate.
 */
export type ServerPromptAssemblyRoute =
  | { type: 'local' }
  | { type: 'server' }
  | { type: 'unsupported'; reason: string }

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
// (`formatHistoryMessage.ts:76,85,154`). As of slice 3a the server assembler
// resolves these (inlay bytes ride the request `inlayAssets`; asset bytes come
// from the server store), so their mere presence no longer forces `unsupported`
// — only the non-vision caption sub-case (class 2) below does.
const INLAY_MARKER = /\{\{(?:inlay|inlayed|inlayeddata)::/i
const ASSET_MARKER = /\{\{asset_?prompt::/i

/**
 * Multimodal / asset content (local-assembler class 1): any message carrying a
 * runtime `multimodals` array (set by scripting at `scriptings.ts:563,938`) or an
 * inlay/asset marker in its `.data`. Ported to the server by slice 3a; still
 * used to detect the class-2 caption sub-case.
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

/** Whether the active model accepts inline image input (`getModelInfo().flags`). */
function modelAcceptsImageInput(): boolean {
  return getModelInfo(getDatabase().aiModel).flags.includes(LLMFlags.hasImageInput)
}

/**
 * Image-gen instruction (local-assembler class 3): `buildInlayViewInstruction`
 * is gated on `currentChar.inlayViewScreen` (`buildStaticPromptSections.ts:48`).
 * Removed by slice 3c.
 */
function charHasImageGenInstruction(currentChar: character): boolean {
  return Boolean(currentChar.inlayViewScreen)
}

function hasLuaTrigger(triggers: triggerscript[] | undefined): boolean {
  if (!Array.isArray(triggers)) return false
  // The Lua edit engine fires only for `effect[0].type === 'triggerlua'`
  // (`scriptings.ts:1449`). CBS/regex triggers are at server parity, so only the
  // Lua arm is the gap.
  return triggers.some((trigger) => trigger?.effect?.[0]?.type === 'triggerlua')
}

/**
 * pluginV2 edit hooks (local-assembler class 5, plugin arm): any registered
 * pluginV2 edit/replacer function. **Permanent `unsupported`** — server-side
 * plugin code execution is on the no-port list (`docs/client-thinning/plan.md`)
 * and pluginV2 is superseded by Plugin V3. This detector never flips to `server`;
 * the `A4R-pluginv2 no server-side plugin execution` audit invariant
 * (`util/client-thinning-audit.ts`) keeps a server-side execution path from being
 * silently added.
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
 * Lua script content (local-assembler classes 4-6): a `triggerlua` effect on the
 * character or any enabled module. The server runs identity for these today (no
 * Lua VM). **Port-pending** — slice 3b stands up a server Lua VM and flips this
 * detector to `server` per sub-class (`editRequest`/`editprocess`/`editinput`) as
 * each lands; until then a Lua trigger hard-fails rather than silently run
 * identity. Kept separate from `hasPluginV2EditSet` so the Lua arm can graduate
 * without disturbing the permanent pluginV2 hard-fail.
 */
function sendHasLuaContent(currentChar: character): boolean {
  return hasLuaTrigger(currentChar.triggerscript) || hasLuaTrigger(getModuleTriggers())
}

/**
 * True if the send carries any content class the server `/chat` assembler cannot
 * yet reproduce. Coarse presence detection: on doubt, report content (→
 * `unsupported`), never silently fall through to a server assembly that would
 * drop it. Each later content slice (3a/3b/3c) deletes exactly one branch here.
 */
function sendHasUnsupportedContent(input: ServerPromptAssemblyInput): string | null {
  // Class 2 (non-vision caption): when the model lacks image input the local
  // assembler replaces an image with a `runImageEmbedding` caption
  // (`formatHistoryMessage.ts:111-114`) — a browser-only ML pipeline with no
  // server equivalent. Rather than emit a silently captionless prompt, any
  // image/asset/inlay content on a non-vision model is `unsupported`. (Class 1,
  // the vision path, is now server-assembled; see `sendHasMultimodalOrAsset`.)
  if (sendHasMultimodalOrAsset(input.currentChat) && !modelAcceptsImageInput()) {
    return 'This model has no image input, so image/asset content would need the browser caption fallback, which server prompt assembly cannot reproduce. Disable server prompt assembly to send it.'
  }
  if (charHasImageGenInstruction(input.currentChar)) {
    return 'Image-generation view instructions are not yet supported by server prompt assembly. Disable server prompt assembly to send.'
  }
  // Lua scripts (classes 4-6): port-pending. Needs a server Lua VM (slice 3b);
  // until each hook lands, a `triggerlua` effect hard-fails rather than run the
  // server's identity transform and silently drop the script's edits.
  if (sendHasLuaContent(input.currentChar)) {
    return 'Lua scripts on this character are not yet supported by server prompt assembly. Disable server prompt assembly to send.'
  }
  // pluginV2 (class 5, plugin arm): permanent `unsupported` (no-port list;
  // deprecated by Plugin V3). Reported separately from the Lua arm above so the
  // Lua sub-classes can flip to `server` independently while this stays a hard
  // fail forever — see `hasPluginV2EditSet`.
  if (hasPluginV2EditSet()) {
    return 'Plugin (V2) scripts run only in the browser plugin runtime and are not supported by server prompt assembly. Disable server prompt assembly to send.'
  }
  return null
}

/**
 * Build the minimal `RequestDataArgumentExtended` that `resolveServerCompletionRoute`
 * reads, mirroring `requestChatDataMain`'s model resolution for the main ('model')
 * send (`request.ts:477-511`). The dead `seperateModels` branch (its keys are
 * memory/emotion/translate/otherAx, never 'model') and the request-only fields
 * (formated/maxTokens/…) are omitted. `getModelInfo` returns a fresh clone, so the
 * reverse_proxy `format` mutation is local to this throwaway target.
 */
function buildCompletionTarg(): RequestDataArgumentExtended {
  const db = getDatabase()
  const aiModel = db.aiModel
  const modelInfo = getModelInfo(aiModel)
  if (aiModel === 'reverse_proxy') {
    modelInfo.internalID = db.customProxyRequestModel
    modelInfo.format = db.customAPIFormat
  }
  return { aiModel, modelInfo } as RequestDataArgumentExtended
}

/**
 * Decide whether `sendChat` must assemble its prompt on the server, hard-fail, or
 * fall back to the in-browser assembler. Mirrors `resolveServerCompletionRoute`'s
 * shape: a pure verdict whose `local` arm is the dev/web/test escape.
 *
 * Decision order (copying the precedent):
 *   1. `!isFastifyServer` → `local` (the precedent's only `local`; dev/web/tests).
 *   1b. master enable off → `local`. `useServerPromptAssembly` is an experimental,
 *       default-off migration gate (`database.svelte.ts:1354`); while off, server
 *       assembly is not attempted and the send uses the local assembler exactly as
 *       before. This is the one `local` verdict that survives in Fastify mode; it
 *       disappears with the flag at the END of the prompt-assembly thinning
 *       sub-family (after slices 3a/3b/3c), leaving `!isFastifyServer` as the sole
 *       `local` return — the precedent's shape.
 *   2. mode / user-message structural check (subsumes the old, silently-falling
 *      `canUseServerAssembly` at `serverBackedSendChat.ts:142`).
 *   3. single, non-group character.
 *   4. server-routable provider (reuse `resolveServerCompletionRoute`).
 *   5. no image-gen / Lua / pluginV2 content, and no non-vision caption case
 *      (image/asset/inlay content on a model without image input — class 2).
 *      Vision-model image/asset/inlay content is server-assembled (slice 3a). The
 *      Lua arm is port-pending (slice 3b flips it per sub-class); the pluginV2
 *      arm is a permanent hard fail (no-port list).
 *   6. otherwise → `server`.
 *
 * From step 2 on (Fastify mode, flag on) the verdict is always `server` or
 * `unsupported` — never a silent local fall-through.
 */
export function resolveServerPromptAssembly(
  input: ServerPromptAssemblyInput,
): ServerPromptAssemblyRoute {
  if (!isFastifyServer) return { type: 'local' }
  if (!getDatabase().useServerPromptAssembly) return { type: 'local' }

  const mode = deriveMode(input)
  if (mode === 'send') {
    const lastMessage = input.currentChat.message.at(-1)
    if (lastMessage?.role !== 'user' || typeof lastMessage.data !== 'string') {
      return {
        type: 'unsupported',
        reason:
          'Server prompt assembly for a send requires the last message to be a text user message.',
      }
    }
  }

  // Group chat is legacy (filtered at load, `database.svelte.ts:110`, and
  // `isGroupChat` is hardcoded false) but the flag's JSDoc still lists it as a
  // non-parity item — surface it explicitly instead of trusting the filter.
  if ((input.currentChar as { type?: string }).type === 'group') {
    return {
      type: 'unsupported',
      reason: 'Group chats are not supported by server prompt assembly.',
    }
  }

  const completionRoute = resolveServerCompletionRoute(buildCompletionTarg())
  if (completionRoute.type !== 'server') {
    return {
      type: 'unsupported',
      reason:
        completionRoute.type === 'unsupported'
          ? completionRoute.reason
          : 'The selected model is not routable in Fastify server mode.',
    }
  }

  const contentReason = sendHasUnsupportedContent(input)
  if (contentReason !== null) {
    return { type: 'unsupported', reason: contentReason }
  }

  return { type: 'server' }
}
