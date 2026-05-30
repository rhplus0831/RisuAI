import {
  resolveServerPromptAssembly,
  type ServerPromptAssemblyInput,
} from './serverPromptAssembly'

/**
 * Two-arm verdict for the durable-generation subset gate (Milestone 1 =
 * survive client disconnect only). Deliberately **not** the 3-arm
 * `local | server | unsupported` shape of `resolveServerPromptAssembly` /
 * `resolveServerCompletionRoute`: those gates carry an `unsupported` arm that
 * **must hard-fail** because a wrong prompt assembly or a mis-routed provider
 * silently corrupts the send. There is no analogous correctness hole here — a
 * send that is not durable-eligible simply uses today's connection-scoped flow,
 * which is *correct*, just not disconnect-survivable. Durability is an
 * **enhancement, not a correctness gate**, so a non-eligible send never
 * hard-fails; it falls back to the inline flow.
 *
 * `reason` is for diagnostics / tests and a future "why can't this chat survive
 * disconnect?" hint — it never triggers a hard fail.
 *
 * See `docs/durable-generation/steps/step-1-subset-gate.md`.
 */
export type DurableGenerationRoute =
  | { type: 'durable' }
  | { type: 'non-durable'; reason: string }

type DurableGenerationMode = 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'

/**
 * Mirrors `deriveMode` (`serverPromptAssembly.ts`) and `serverChatMode`
 * (`serverBackedSendChat.ts`). Kept local so the durable gate has no new input
 * fields — it reuses `ServerPromptAssemblyInput` verbatim.
 */
function deriveMode(input: ServerPromptAssemblyInput): DurableGenerationMode {
  if (input.previewPrompt) return 'preview_prompt'
  if (input.preview) return 'preview'
  if (typeof input.regenerateMessageId === 'string') return 'regenerate'
  if (input.continue) return 'continue'
  return 'send'
}

/**
 * Decide whether a send is **durable-generation-eligible** — i.e. the server
 * owns the whole generation lifecycle (survive disconnect, persist the result,
 * reattach). A thin restriction of `resolveServerPromptAssembly`: the durable
 * subset is the server-assembled subset, narrowed to `send` mode.
 *
 * Decision order (per the step spec):
 *   1. mode must be a **generating** mode: `send`, `continue`, or `regenerate`
 *      (lazy-projection Phase 6b widened this past the Milestone-1 send-only cut).
 *      The server finalizes all three mode-correctly (`resolvePostGenerationResult`:
 *      continue extends the last row in place, regenerate replaces the target,
 *      send appends), keyed idempotently for replay. `preview` / `preview_prompt`
 *      never generate → `non-durable`.
 *   2. delegate to `resolveServerPromptAssembly`. Anything other than `server`
 *      → `non-durable`, carrying the assembly gate's `unsupported` reason (or a
 *      generic "not server-assembled" for the `local` arm: `!isFastifyServer`
 *      or the `useServerPromptAssembly` master-enable off). This single
 *      delegation inherits ALL of the assembly subset: non-text send, group
 *      char, non-server-routable provider, non-vision image caption fallback,
 *      interactive Lua dialogs, and pluginV2 edit/replacer hooks all stay
 *      `non-durable`; image-input multimodal/asset content, the image-gen view
 *      instruction, and non-interactive Lua edit/input hooks are in-subset
 *      because the relevant client-thinning slices landed.
 *   3. otherwise → `durable`.
 *
 * Decision #2 (2026-05-30): output triggers and `editoutput` are **in-subset** —
 * client-thinning slice 4 (A2) landed, so the durable job runs
 * `runServerPostGeneration` at completion and persists the derived final text +
 * scriptstate delta (Step 3). There is no remaining post-gen surface this gate
 * must screen, so it adds exactly **one** restriction (a generating mode) on top
 * of the assembly subset; durable coverage widens automatically as that subset does.
 */
const DURABLE_MODES: ReadonlySet<DurableGenerationMode> = new Set([
  'send',
  'continue',
  'regenerate',
])

export function resolveDurableGeneration(input: ServerPromptAssemblyInput): DurableGenerationRoute {
  if (!DURABLE_MODES.has(deriveMode(input))) {
    return {
      type: 'non-durable',
      reason: 'durable generation supports send, continue, and regenerate modes only',
    }
  }

  const assembly = resolveServerPromptAssembly(input)
  if (assembly.type !== 'server') {
    return {
      type: 'non-durable',
      reason: assembly.type === 'unsupported' ? assembly.reason : 'not server-assembled',
    }
  }

  return { type: 'durable' }
}
