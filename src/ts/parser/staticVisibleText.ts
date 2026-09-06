import css from '@adobe/css-tools'
import selectorParser from 'postcss-selector-parser'

const omittedTags = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT'])
const blockTags = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'ASIDE',
  'HEADER',
  'FOOTER',
  'BLOCKQUOTE',
  'PRE',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'TR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'DETAILS',
  'SUMMARY',
  'HR',
])
const visibilityProperties = new Set(['display', 'visibility', 'content-visibility'])
type Declaration = { property: string; value: string; important: boolean }
type Rule = { selector: string; weight: number; declarations: Declaration[] }

function specificity(selector: string): number {
  let weight = 0
  selectorParser((root) =>
    root.walk((node) => {
      if (node.type === 'id') weight += 10000
      else if (node.type === 'class' || node.type === 'attribute' || node.type === 'pseudo') weight += 100
      else if (node.type === 'tag') weight += 1
    }),
  ).processSync(selector)
  return weight
}

/** Extract text from static display HTML, without mounting messages or consulting
 * viewport geometry. Unconditional embedded CSS and inline visibility declarations
 * participate; interactive and media/container-query states are not simulated.
 */
export function staticVisibleText(html: string): string {
  const doc = document.implementation.createHTMLDocument('')
  const root = doc.createElement('div')
  root.className = 'chattext'
  root.innerHTML = html
  doc.body.append(root)
  const rules: Rule[] = []
  for (const style of root.querySelectorAll('style')) {
    try {
      for (const rule of css.parse(style.textContent ?? '').stylesheet.rules) {
        if (rule.type !== 'rule') continue
        const declarations: Declaration[] = []
        for (const declaration of rule.declarations ?? []) {
          if (declaration.type !== 'declaration' || !visibilityProperties.has(declaration.property)) continue
          const value = declaration.value.trim().toLowerCase()
          declarations.push({
            property: declaration.property,
            value: value.replace(/\s*!important$/, ''),
            important: /!important$/.test(value),
          })
        }
        for (const selector of rule.selectors ?? []) {
          rules.push({ selector, weight: specificity(selector), declarations })
        }
      }
    } catch {
      // Invalid CSS is ignored by the display as well.
    }
  }

  function styleValues(element: HTMLElement): Map<string, string> {
    const values = new Map<string, { value: string; weight: number }>()
    const apply = (declaration: Declaration, weight: number) => {
      weight += declaration.important ? 100000000 : 0
      if (weight >= (values.get(declaration.property)?.weight ?? -1))
        values.set(declaration.property, { value: declaration.value, weight })
    }
    for (const rule of rules) {
      try {
        if (element.matches(rule.selector)) rule.declarations.forEach((value) => apply(value, rule.weight))
      } catch {
        /* Unsupported selectors do not match. */
      }
    }
    for (const property of visibilityProperties) {
      const value = element.style?.getPropertyValue(property).trim().toLowerCase()
      if (value)
        apply({ property, value, important: element.style.getPropertyPriority(property) === 'important' }, 1000000)
    }
    return new Map([...values].map(([property, value]) => [property, value.value]))
  }

  const parts: string[] = []
  function newline() {
    if (parts.length && !parts.at(-1)?.endsWith('\n')) parts.push('\n')
  }
  function walk(node: Node, hidden = false, pre = false): void {
    if (node.nodeType === 3) {
      if (!hidden) parts.push(pre ? (node.textContent ?? '') : (node.textContent ?? '').replace(/\s+/g, ' '))
      return
    }
    if (node.nodeType !== 1) return
    const element = node as HTMLElement
    if (omittedTags.has(element.tagName) || element.hasAttribute('hidden')) return
    const styles = styleValues(element)
    if (styles.get('display') === 'none' || styles.get('content-visibility') === 'hidden') return
    const visibility = styles.get('visibility')
    hidden = visibility === 'visible' ? false : visibility === 'hidden' || visibility === 'collapse' ? true : hidden
    if (element.tagName === 'BR') {
      if (!hidden) newline()
      return
    }
    const block = blockTags.has(element.tagName)
    if (block) newline()
    if (element.tagName === 'DETAILS' && !element.hasAttribute('open')) {
      const summary = [...element.children].find((child) => child.tagName === 'SUMMARY')
      if (summary) walk(summary, hidden, pre)
    } else {
      for (const child of element.childNodes) walk(child, hidden, pre || element.tagName === 'PRE')
    }
    if (element.tagName === 'TD' || element.tagName === 'TH') parts.push('\t')
    else if (block) newline()
  }
  walk(root)
  return parts.join('').trim()
}
