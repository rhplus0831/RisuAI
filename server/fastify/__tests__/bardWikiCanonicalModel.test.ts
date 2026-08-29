import { describe, expect, it } from 'vitest'
import {
  stageBardWikiCanonicalChanges,
  validateBardWikiCanonicalOperations,
  type BardWikiCanonicalDocumentSnapshot,
} from '../src/bardWikiCanonicalModel.js'

const snapshot: BardWikiCanonicalDocumentSnapshot[] = [
  {
    id: 'character-mira',
    kind: 'character',
    title: 'Mira',
    logicalPath: 'Characters/Mira',
    aliases: [],
    version: 4,
    contentHash: 'hash-v4',
    markdown: '## Profile\n\nIntro.\n\n### Traits\n\nOld.\n\n### Notes\n\nKeep.',
  },
]

describe('BardWiki canonical compiler contract', () => {
  it('accepts fenced strict operations and changes only the named H3 section', () => {
    const operations = validateBardWikiCanonicalOperations(
      [
        '```json',
        JSON.stringify([
          {
            op: 'upsert_h3',
            documentId: 'character-mira',
            baseVersion: 4,
            baseHash: 'hash-v4',
            heading: 'Traits',
            markdown: 'New.\n\n```md\n### code sample\n```',
          },
        ]),
        '```',
      ].join('\n'),
      snapshot,
    )
    expect(stageBardWikiCanonicalChanges(operations, snapshot)).toEqual([
      {
        type: 'update',
        documentId: 'character-mira',
        beforeVersion: 4,
        beforeHash: 'hash-v4',
        markdown: '## Profile\n\nIntro.\n\n### Traits\n\nNew.\n\n```md\n### code sample\n```\n\n### Notes\n\nKeep.',
      },
    ])
  })

  it('renders bounded creates and rejects duplicate normalized section headings', () => {
    const create = JSON.stringify([
      {
        op: 'create',
        kind: 'location',
        title: 'Old Tavern',
        logicalPath: 'Locations/Old Tavern',
        aliases: ['Tavern'],
        sections: [
          { heading: 'Overview', markdown: 'A quiet room.' },
          { heading: 'People', markdown: 'Mira.' },
        ],
      },
    ])
    expect(
      stageBardWikiCanonicalChanges(validateBardWikiCanonicalOperations(create, snapshot), snapshot),
    ).toMatchObject([
      {
        type: 'create',
        kind: 'location',
        logicalPath: 'Locations/Old Tavern',
        markdown: '### Overview\n\nA quiet room.\n\n### People\n\nMira.',
      },
    ])

    const duplicate = JSON.stringify([
      {
        op: 'create',
        kind: 'location',
        title: 'Old Tavern',
        logicalPath: 'Locations/Other',
        aliases: [],
        sections: [
          { heading: ' Overview ', markdown: 'One.' },
          { heading: 'Overview', markdown: 'Two.' },
        ],
      },
    ])
    expect(() => validateBardWikiCanonicalOperations(duplicate, snapshot)).toThrow(/duplicate H3 heading/u)
  })

  it('rejects whole-document replacement, stale fences, hidden H3 injection, and excess operations', () => {
    expect(() => validateBardWikiCanonicalOperations('[{"op":"replace_all"}]', snapshot)).toThrow(/op is invalid/u)
    expect(() =>
      validateBardWikiCanonicalOperations(
        '[{"op":"delete_h3","documentId":"character-mira","baseVersion":3,"baseHash":"old","heading":"Traits"}]',
        snapshot,
      ),
    ).toThrow(/base fence/u)
    expect(() =>
      validateBardWikiCanonicalOperations(
        '[{"op":"upsert_h3","documentId":"character-mira","baseVersion":4,"baseHash":"hash-v4","heading":"Traits","markdown":"### Hidden\\n\\nNo."}]',
        snapshot,
      ),
    ).toThrow(/cannot contain H1-H3/u)
    expect(() =>
      validateBardWikiCanonicalOperations(JSON.stringify(Array(33).fill({ op: 'invalid' })), snapshot),
    ).toThrow(/exceeds 32 operations/u)
  })

  it('deletes only an existing named H3 section', () => {
    const operations = validateBardWikiCanonicalOperations(
      '[{"op":"delete_h3","documentId":"character-mira","baseVersion":4,"baseHash":"hash-v4","heading":"Traits"}]',
      snapshot,
    )
    expect(stageBardWikiCanonicalChanges(operations, snapshot)[0]).toMatchObject({
      markdown: '## Profile\n\nIntro.\n\n### Notes\n\nKeep.',
    })
  })
})
