import type { FastifyChat as Chat, FastifyCharacter as character, FastifyDatabase as Database } from './serverTypes.js'
import type { PromptMessage } from './promptMessage.js'
import { resolveEffectivePromptTemplate } from '@risuai/shared-core/effective-prompt-template'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Static prompt sections ported from the SPA's `buildStaticPromptSections.ts`
 * and `buildDescription.ts`.
 *
 * Mirrors browser behavior for `{{description}}`, `{{personality}}`,
 * `{{scenario}}` assembly, the author-note default-text fallback into
 * `db.promptTemplate`, the persona prompt, the chain-of-thought
 * instruction, and the image-gen / emotion view instruction.
 * Each function returns `PromptMessage[]` (normalized — the SPA's
 * `buildDescription` returns a single object; the server smooths the
 * asymmetry so the assembler can `.flatMap` uniformly).
 *
 * Embedding-based `additionalInformations` are not included in static sections.
 */

const COT_INSTRUCTION =
  '<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>'

/**
 * Walks the effective prompt template for an `authornote` card and returns its
 * `defaultText`. Mirrors `src/ts/util.ts getAuthorNoteDefaultText`.
 */
function authorNoteDefaultText(db: Database, currentChat: Chat): string {
  const template = resolveEffectivePromptTemplate(db, {
    chatPromptPresetId: currentChat.generationSettings?.promptPresetId,
  }).promptTemplate
  if (!template) return ''
  for (const v of template as Array<{ type?: string; defaultText?: string }>) {
    if (v && v.type === 'authornote') return v.defaultText ?? ''
  }
  return ''
}

function expandWith(ctx: ExpandContext, input: string): string {
  return expandVariables(input, ctx).text
}

export function buildDescription(ctx: ExpandContext, currentChar: character): PromptMessage[] {
  const db = ctx.database
  const prefix = db.promptPreprocess ? (db.descriptionPrefix ?? '') : ''
  let description = expandWith(ctx, prefix + (currentChar.desc ?? ''))

  if (currentChar.personality) {
    description += expandWith(ctx, '\n\nDescription of {{char}}: ' + currentChar.personality)
  }

  if (currentChar.scenario) {
    description += expandWith(ctx, '\n\nCircumstances and context of the dialogue: ' + currentChar.scenario)
  }

  return [{ role: 'system', content: description }]
}

export function buildAuthorNote(ctx: ExpandContext, currentChat: Chat): PromptMessage[] {
  if (currentChat.note) {
    return [{ role: 'system', content: expandWith(ctx, currentChat.note) }]
  }
  const defaultText = authorNoteDefaultText(ctx.database, currentChat)
  if (defaultText !== '') {
    return [{ role: 'system', content: expandWith(ctx, defaultText) }]
  }
  return []
}

export function buildPersona(ctx: ExpandContext): PromptMessage[] {
  const personaPrompt = ctx.database.personaPrompt
  if (!personaPrompt) return []
  return [{ role: 'system', content: expandWith(ctx, personaPrompt) }]
}

export function buildCotInstruction(ctx: ExpandContext, usingPromptTemplate: boolean): PromptMessage[] {
  const db = ctx.database
  if (!db.chainOfThought) return []
  if (usingPromptTemplate && db.promptSettings?.customChainOfThought) return []
  return [{ role: 'system', content: COT_INSTRUCTION }]
}

/**
 * Image-gen / emotion view instruction, ported from the SPA's
 * `buildInlayViewInstruction`. Gated on
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
 * Image generation and inlay-screen rendering remain post-generation browser
 * effects; only this instruction text is assembled server-side.
 */
export function buildInlayViewInstruction(currentChar: character): PromptMessage[] {
  if (!currentChar.inlayViewScreen) return []
  if (currentChar.viewScreen === 'emotion') {
    return [
      {
        role: 'system',
        content: (currentChar.newGenData?.emotionInstructions ?? '').replaceAll(
          '{{slot}}',
          currentChar.emotionImages.map((v: [string, string]) => v[0]).join(', '),
        ),
      },
    ]
  }
  if (currentChar.viewScreen === 'imggen') {
    return [{ role: 'system', content: currentChar.newGenData?.instructions ?? '' }]
  }
  return []
}
