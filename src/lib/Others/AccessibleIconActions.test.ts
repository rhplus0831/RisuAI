import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generate } from 'astring'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'

type AstNode = {
  attributes?: AstNode[]
  data?: string
  expression?: AstNode
  fragment?: AstNode
  name?: string
  type?: string
  value?: unknown
  [key: string]: unknown
}

type IconActionContract = {
  icon: string
  label: string
  tag?: 'a' | 'button'
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

function containsComponent(fragment: AstNode | undefined, componentName: string): boolean {
  let found = false
  walkAst(fragment, (node) => {
    if (node.type === 'Component' && node.name === componentName) found = true
  })
  return found
}

function hasVisibleText(fragment: AstNode | undefined): boolean {
  let visible = false
  walkAst(fragment, (node) => {
    if (node.type === 'Text' && node.data?.trim()) visible = true
    if (node.type === 'ExpressionTag') visible = true
  })
  return visible
}

function attributeValueDescriptor(attribute: AstNode): string | undefined {
  if (Array.isArray(attribute.value)) {
    let descriptor = ''
    for (const part of attribute.value as AstNode[]) {
      if (part.type === 'Text' && typeof part.data === 'string') {
        descriptor += part.data
      } else if (part.type === 'ExpressionTag') {
        if (!part.expression) return undefined
        descriptor += `\${${generate(part.expression as Parameters<typeof generate>[0])}}`
      } else {
        return undefined
      }
    }
    return descriptor || undefined
  }
  if (attribute.value && typeof attribute.value === 'object') {
    const value = attribute.value as AstNode
    if (value.type === 'ExpressionTag' && value.expression) {
      return generate(value.expression as Parameters<typeof generate>[0])
    }
  }
  return undefined
}

function expectIconActions(file: string, contracts: readonly IconActionContract[]): void {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  const ast = parse(source, { filename: file, modern: true })
  const nativeActions: AstNode[] = []
  walkAst(ast.fragment, (node) => {
    if (node.type === 'RegularElement' && (node.name === 'button' || node.name === 'a')) {
      nativeActions.push(node)
    }
  })

  for (const contract of contracts) {
    const matches = nativeActions.filter((node) => containsComponent(node.fragment, contract.icon))
    expect(matches, `${contract.icon} must have one native action in ${file}`).toHaveLength(1)
    const action = matches[0]!
    expect(action.name, `${contract.icon} must retain native action semantics`).toBe(contract.tag ?? 'button')
    expect(hasVisibleText(action.fragment), `${contract.icon} must remain a visual-only action`).toBe(false)

    const nameAttributes = (action.attributes ?? []).filter(
      (attribute) =>
        attribute.type === 'Attribute' && (attribute.name === 'aria-label' || attribute.name === 'aria-labelledby'),
    )
    expect(nameAttributes, `${contract.icon} must have one accessible-name mechanism`).toHaveLength(1)
    expect(attributeValueDescriptor(nameAttributes[0]!), `${contract.icon} must use the intended accessible name`).toBe(
      contract.label,
    )
  }
}

describe('standalone icon action names', () => {
  it('names parameter import and export actions', () => {
    expectIconActions('src/lib/Others/AllSeperateParameters.svelte', [
      { icon: 'FileDownIcon', label: '`${language.export}: ${language.parameters}`' },
      { icon: 'FileUpIcon', label: '`${language.import}: ${language.parameters}`' },
    ])
  })

  it('names color scheme import and export actions', () => {
    expectIconActions('src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte', [
      { icon: 'DownloadIcon', label: '`${language.export}: ${language.colorScheme}`' },
      { icon: 'HardDriveUploadIcon', label: '`${language.import}: ${language.colorScheme}`' },
    ])
  })

  it('names the prompt diff close action', () => {
    expectIconActions('src/lib/Others/PromptDiffModal.svelte', [{ icon: 'XIcon', label: 'language.close' }])
  })

  it('names every utility-link icon', () => {
    expectIconActions('src/lib/Others/GithubStars.svelte', [
      { icon: 'HouseIcon', label: 'language.home' },
      { icon: 'WalletIcon', label: 'Patreon' },
      { icon: 'MailIcon', label: 'risuai@proton.me' },
      { icon: 'MaximizeIcon', label: 'language.fullscreen' },
    ])
  })
})
