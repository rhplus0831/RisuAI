import type { Chat, Database, character } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Phase 7-3 static prompt sections ported from the SPA's
 * `src/ts/process/promptAssembly/buildStaticPromptSections.ts` and
 * `buildDescription.ts`.
 *
 * Mirrors browser behavior for `{{description}}`, `{{personality}}`,
 * `{{scenario}}` assembly, the author-note default-text fallback into
 * `db.promptTemplate`, the persona prompt, the chain-of-thought
 * instruction, and (slice 3c) the image-gen / emotion view instruction.
 * Each function returns `OpenAIChat[]` (normalized — the SPA's
 * `buildDescription` returns a single object; the server smooths the
 * asymmetry so the assembler can `.flatMap` uniformly).
 *
 * Deferred to later slices:
 * - `additionalInformations` (embedding-based extras; Phase 8 memory).
 */

const COT_INSTRUCTION =
  '<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>'

/**
 * Walks `db.promptTemplate` for an `authornote` card and returns its
 * `defaultText`. Mirrors `src/ts/util.ts:335 getAuthorNoteDefaultText`.
 */
function authorNoteDefaultText(db: Database): string {
  const template = db.promptTemplate
  if (!template) return ''
  for (const v of template as Array<{ type?: string; defaultText?: string }>) {
    if (v && v.type === 'authornote') return v.defaultText ?? ''
  }
  return ''
}

function expandWith(ctx: ExpandContext, input: string): string {
  return expandVariables(input, ctx).text
}

export function buildDescription(
  ctx: ExpandContext,
  currentChar: character,
): OpenAIChat[] {
  const db = ctx.database
  const prefix = db.promptPreprocess ? db.descriptionPrefix ?? '' : ''
  let description = expandWith(ctx, prefix + (currentChar.desc ?? ''))

  if (currentChar.personality) {
    description += expandWith(
      ctx,
      '\n\nDescription of {{char}}: ' + currentChar.personality,
    )
  }

  if (currentChar.scenario) {
    description += expandWith(
      ctx,
      '\n\nCircumstances and context of the dialogue: ' + currentChar.scenario,
    )
  }

  return [{ role: 'system', content: description }]
}

export function buildAuthorNote(
  ctx: ExpandContext,
  currentChat: Chat,
): OpenAIChat[] {
  if (currentChat.note) {
    return [{ role: 'system', content: expandWith(ctx, currentChat.note) }]
  }
  const defaultText = authorNoteDefaultText(ctx.database)
  if (defaultText !== '') {
    return [{ role: 'system', content: expandWith(ctx, defaultText) }]
  }
  return []
}

export function buildPersona(ctx: ExpandContext): OpenAIChat[] {
  const personaPrompt = ctx.database.personaPrompt
  if (!personaPrompt) return []
  return [{ role: 'system', content: expandWith(ctx, personaPrompt) }]
}

export function buildCotInstruction(
  ctx: ExpandContext,
  usingPromptTemplate: boolean,
): OpenAIChat[] {
  const db = ctx.database
  if (!db.chainOfThought) return []
  if (usingPromptTemplate && db.promptSettings?.customChainOfThought) return []
  return [{ role: 'system', content: COT_INSTRUCTION }]
}

/**
 * Slice 3c: the image-gen / emotion view instruction, ported from the SPA's
 * `buildStaticPromptSections.ts::buildInlayViewInstruction`. Gated on
 * `currentChar.inlayViewScreen`; emits a single `system` row drawn from the
 * static `newGenData` character config:
 *
 * - `viewScreen === 'emotion'` → `newGenData.emotionInstructions`, with `{{slot}}`
 *   replaced by the comma-joined `emotionImages` names.
 * - `viewScreen === 'imggen'` → `newGenData.instructions`.
 *
 * No variable expansion: unlike the other static builders, the SPA does **not**
 * run `risuChatParser` here, so the row is byte-identical to the browser apart
 * from the manual `{{slot}}` swap (and `ctx` is intentionally not a parameter).
 * `newGenData` is optional on `character`; the SPA assumes it is present when
 * `inlayViewScreen` is set, so the `?? ''` fallback only guards the
 * (browser-crashing) malformed case without diverging on the supported path.
 *
 * The actual image generation / inlay-screen rendering stays a post-gen browser
 * effect (B1) — only this instruction text moves to the server.
 */
export function buildInlayViewInstruction(currentChar: character): OpenAIChat[] {
  if (!currentChar.inlayViewScreen) return []
  if (currentChar.viewScreen === 'emotion') {
    return [
      {
        role: 'system',
        content: (currentChar.newGenData?.emotionInstructions ?? '').replaceAll(
          '{{slot}}',
          currentChar.emotionImages.map((v) => v[0]).join(', '),
        ),
      },
    ]
  }
  if (currentChar.viewScreen === 'imggen') {
    return [{ role: 'system', content: currentChar.newGenData?.instructions ?? '' }]
  }
  return []
}
