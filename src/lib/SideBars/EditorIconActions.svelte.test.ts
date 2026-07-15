import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'

const EDITOR_SOURCES = [
  'src/lib/SideBars/CharConfig.svelte',
  'src/lib/SideBars/DevTool.svelte',
  'src/lib/SideBars/LoreBook/LoreBookSetting.svelte',
  'src/lib/SideBars/LoreBook/LoreBookData.svelte',
  'src/lib/SideBars/Scripts/TriggerV1List.svelte',
  'src/lib/SideBars/Scripts/TriggerV1Data.svelte',
  'src/lib/SideBars/Scripts/RegexList.svelte',
  'src/lib/SideBars/Scripts/RegexData.svelte',
  'src/lib/SideBars/Scripts/TriggerV2List.svelte',
  'src/lib/Setting/botpreset.svelte',
  'src/lib/Setting/listedPersona.svelte',
] as const

type AstNode = {
  attributes?: AstNode[]
  data?: string
  fragment?: AstNode
  name?: string
  start?: number
  type?: string
  [key: string]: unknown
}

function walkAst(node: unknown, visit: (node: AstNode) => void): void {
  if (!node || typeof node !== 'object') return
  const astNode = node as AstNode
  visit(astNode)
  for (const [key, value] of Object.entries(astNode)) {
    if (key === 'attributes' || key === 'metadata' || key === 'parent') continue
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit)
    } else {
      walkAst(value, visit)
    }
  }
}

function hasVisibleButtonText(fragment: AstNode | undefined): boolean {
  let visible = false
  walkAst(fragment, (node) => {
    if (node.type === 'Text' && node.data?.trim()) visible = true
    if (node.type === 'ExpressionTag') visible = true
  })
  return visible
}

function attributeNames(node: AstNode): Set<string> {
  return new Set(
    (node.attributes ?? [])
      .filter((attribute) => attribute.type === 'Attribute' && typeof attribute.name === 'string')
      .map((attribute) => attribute.name as string),
  )
}

describe('character, lore, and script editor icon actions', () => {
  it.each(EDITOR_SOURCES)('%s names every visual-only button', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    const ast = parse(source, { filename: file, modern: true })
    const unnamedLines: number[] = []

    walkAst(ast.fragment, (node) => {
      if (node.type !== 'RegularElement' || node.name !== 'button' || hasVisibleButtonText(node.fragment)) return
      const attributes = attributeNames(node)
      if (attributes.has('aria-label') || attributes.has('aria-labelledby')) return
      unnamedLines.push(source.slice(0, node.start ?? 0).split('\n').length)
    })

    expect(unnamedLines, `Unnamed visual-only buttons in ${file}`).toEqual([])
  })
})
