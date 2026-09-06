import { describe, expect, it } from 'vitest'
import { BARDWIKI_EVENT_MODEL_OUTPUT_MAX_BYTES, validateBardWikiEventDraft } from '../src/bardWikiEventModel.js'

describe('BardWiki event model-output contract', () => {
  it('accepts a strict object and normalizes only the locked draft fields', () => {
    expect(
      validateBardWikiEventDraft(
        `\`\`\`json\n${JSON.stringify({
          title: '  Lantern   Night ',
          logicalPath: ' Events\\Lantern ',
          aliases: [' Night '],
          markdown: '## Night\nSafe.',
        })}\n\`\`\``,
      ),
    ).toEqual({
      title: 'Lantern Night',
      logicalPath: 'Events/Lantern',
      aliases: ['Night'],
      markdown: '## Night\nSafe.',
    })
  })

  it.each([
    '{"title":"A","logicalPath":"Events/A","aliases":[],"markdown":"A","chatId":"foreign"}',
    '{"title":"A","logicalPath":"Events/A","aliases":"wrong","markdown":"A"}',
    '{"title":"A","logicalPath":"../escape","aliases":[],"markdown":"A"}',
    'not json',
  ])('rejects malformed or authority-expanding output', (output) => {
    expect(() => validateBardWikiEventDraft(output)).toThrow()
  })

  it('rejects output over the locked 64 KiB boundary before parsing', () => {
    const output = 'x'.repeat(BARDWIKI_EVENT_MODEL_OUTPUT_MAX_BYTES + 1)
    expect(() => validateBardWikiEventDraft(output)).toThrow(/64 KiB/u)
  })
})
