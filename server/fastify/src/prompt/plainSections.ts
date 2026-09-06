import type { FastifyCharacter as character } from './serverTypes.js'
import type { PromptMessage } from './promptMessage.js'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Plain prompt sections ported from the SPA's `buildPlainPromptSections.ts`.
 *
 * Produces the three top-level system-style blocks the assembler
 * consumes when the user has not switched to a structured promptTemplate:
 *
 * - `main`: `db.mainPrompt`, with optional `{{original}}` substitution
 *   from `currentChar.systemPrompt` and `db.additionalPrompt` appended
 *   when `promptPreprocess` is true.
 * - `jailbreak`: `db.jailbreak`, only when `db.jailbreakToggle` is true.
 * - `globalNote`: `db.globalNote`, with optional `{{original}}`
 *   substitution from `currentChar.replaceGlobalNote`.
 *
 * Each block is run through `expandVariables`, then split by
 * `@@user` / `@@assistant` / `@@system` markers (also accepting the
 * `@@@user` triple-at form). Text without any marker defaults to a
 * single `system` message.
 */

const ROLE_SPLIT_RE = /@@@?(user|assistant|system)\n/

function formatPrompt(data: string): PromptMessage[] {
  let body = data
  if (!body.startsWith('@@')) {
    body = '@@system\n' + body
  }
  const parts = body.split(ROLE_SPLIT_RE)
  const out: PromptMessage[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i] as 'user' | 'assistant' | 'system'
    const content = parts[i + 1]?.trim() ?? ''
    out.push({ role, content })
  }
  return out
}

function expand(ctx: ExpandContext, input: string): string {
  return expandVariables(input, ctx).text
}

export interface PlainPromptSections {
  main: PromptMessage[]
  jailbreak: PromptMessage[]
  globalNote: PromptMessage[]
}

export function buildPlainPromptSections(ctx: ExpandContext, currentChar: character): PlainPromptSections {
  const db = ctx.database
  const mainPrompt = db.mainPrompt ?? ''

  const mainSource =
    currentChar.systemPrompt && currentChar.systemPrompt.length > 0
      ? currentChar.systemPrompt.replaceAll('{{original}}', mainPrompt)
      : mainPrompt

  const additionalSuffix =
    db.additionalPrompt && db.additionalPrompt.length > 0 && db.promptPreprocess ? `\n${db.additionalPrompt}` : ''

  const main = formatPrompt(expand(ctx, mainSource + additionalSuffix))

  const jailbreak = db.jailbreakToggle ? formatPrompt(expand(ctx, db.jailbreak ?? '')) : []

  const globalNoteSource =
    currentChar.replaceGlobalNote && currentChar.replaceGlobalNote.length > 0
      ? currentChar.replaceGlobalNote.replaceAll('{{original}}', db.globalNote ?? '')
      : (db.globalNote ?? '')

  const globalNote = formatPrompt(expand(ctx, globalNoteSource))

  return { main, jailbreak, globalNote }
}
