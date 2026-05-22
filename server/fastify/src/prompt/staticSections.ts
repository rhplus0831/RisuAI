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
 * `db.promptTemplate`, the persona prompt, and the chain-of-thought
 * instruction. Each function returns `OpenAIChat[]` (normalized — the
 * SPA's `buildDescription` returns a single object; the server smooths
 * the asymmetry so the assembler can `.flatMap` uniformly).
 *
 * Deferred to later slices:
 * - `additionalInformations` (embedding-based extras; Phase 8 memory).
 * - `buildInlayViewInstruction` (image-gen-only; needs `newGenData`).
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
