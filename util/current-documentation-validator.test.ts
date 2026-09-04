import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  validateCurrentDocumentation,
  type CurrentDocumentationValidationOptions,
} from './current-documentation-validator.js'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>, options: Omit<CurrentDocumentationValidationOptions, 'repoRoot'> = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'risu-current-docs-'))
  temporaryRoots.push(repoRoot)
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(repoRoot, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
  return validateCurrentDocumentation({
    documentPaths: Object.keys(files),
    indexSpecs: [],
    literalPathExemptions: [],
    ...options,
    repoRoot,
  })
}

describe('current documentation validator', () => {
  it('reports missing relative Markdown targets while ignoring fenced examples', () => {
    const result = fixture({
      'docs/guide.md': ['# Guide', '', '[missing](absent.md)', '', '```md', '[example](also-absent.md)', '```'].join(
        '\n',
      ),
    })

    expect(result.errors).toEqual([expect.stringContaining('links to missing path "absent.md"')])
  })

  it('rejects local links that escape the repository even when their target exists', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'risu-current-docs-'))
    temporaryRoots.push(repoRoot)
    const outsideTarget = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-outside.md`)
    writeFileSync(outsideTarget, '# Outside\n')
    temporaryRoots.push(outsideTarget)
    mkdirSync(path.join(repoRoot, 'docs'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'docs/guide.md'),
      `[outside](../../${path.basename(outsideTarget)})\nEscaped literal: \`src/../../${path.basename(outsideTarget)}\`.\n`,
    )

    const result = validateCurrentDocumentation({
      documentPaths: ['docs/guide.md'],
      indexSpecs: [],
      literalPathExemptions: [],
      repoRoot,
    })

    expect(result.errors).toEqual([
      expect.stringContaining('links outside the repository'),
      expect.stringContaining('references a path outside the repository'),
    ])
  })

  it('reports missing GitHub-style anchors and accepts duplicate heading suffixes', () => {
    const result = fixture({
      'docs/guide.md': '[valid](target.md#same-heading-1)\n[missing](target.md#not-there)\n',
      'docs/target.md': '# Same heading\n\n# Same heading\n\n```md\n# Not there\n```\n',
    })

    expect(result.errors).toEqual([expect.stringContaining('links to missing anchor "target.md#not-there"')])
  })

  it('reports index drift when a current guide is not linked from its index', () => {
    const result = fixture(
      {
        'docs/topic/README.md': '# Index\n\n[First](first.md)\n',
        'docs/topic/first.md': '# First\n',
        'docs/topic/second.md': '# Second\n',
      },
      { indexSpecs: [{ directory: 'docs/topic', index: 'docs/topic/README.md' }] },
    )

    expect(result.errors).toEqual([expect.stringContaining('does not index "docs/topic/second.md"')])
  })

  it('checks unambiguous repository paths and supports exact intentional-absence exemptions', () => {
    const result = fixture(
      {
        'docs/guide.md': [
          '# Guide',
          '',
          'Missing: `src/missing.ts`.',
          'Intentional: `public/retired.js`.',
          'Family only: `packages/*/README.md`.',
          '',
          '```md',
          'Example: `util/not-real.ts`.',
          '```',
        ].join('\n'),
      },
      {
        literalPathExemptions: [
          { document: 'docs/guide.md', path: 'public/retired.js', reason: 'retired compatibility surface' },
        ],
      },
    )

    expect(result.errors).toEqual([expect.stringContaining('references missing repository path "src/missing.ts"')])
  })
})
