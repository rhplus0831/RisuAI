import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify'

let hubHtmlPurifier: DOMPurifyInstance | undefined

const FORBIDDEN_TAGS = [
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'object',
  'option',
  'script',
  'select',
  'style',
  'svg',
  'textarea',
]
const FORBIDDEN_ATTRIBUTES = ['action', 'class', 'formaction', 'http-equiv', 'srcdoc', 'srcset', 'style']
const URL_ATTRIBUTES = new Set(['background', 'cite', 'href', 'poster', 'src', 'xlink:href'])

function getHubHtmlPurifier(): DOMPurifyInstance | undefined {
  if (hubHtmlPurifier?.isSupported) return hubHtmlPurifier
  if (typeof window === 'undefined') return undefined
  const purifier = DOMPurify(window)
  if (!purifier.isSupported) return undefined
  hubHtmlPurifier = purifier
  return purifier
}

function isSafeHubContentUrl(attributeName: string, value: string): boolean {
  try {
    const parsed = new URL(value, 'https://hub-content.invalid/')
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true
    return attributeName === 'href' && (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:')
  } catch {
    return false
  }
}

function enforceHubHtmlPolicy(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html

  for (const element of template.content.querySelectorAll('*')) {
    if (FORBIDDEN_TAGS.includes(element.localName)) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (
        name.startsWith('on') ||
        FORBIDDEN_ATTRIBUTES.includes(name) ||
        (URL_ATTRIBUTES.has(name) && !isSafeHubContentUrl(name, attribute.value))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
    for (const name of ['id', 'name']) {
      const value = element.getAttribute(name)
      if (value && !value.startsWith('user-content-')) {
        element.setAttribute(name, `user-content-${value}`)
      }
    }
    if (element.getAttribute('target')?.toLowerCase() === '_blank') {
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }

  return template.innerHTML
}

/**
 * Hub announcements are untrusted remote content. Keep ordinary presentational
 * HTML while excluding active, document-level, and form content. The dedicated
 * DOMPurify instance prevents the chat parser's global hooks from changing this
 * policy.
 */
export function sanitizeHubAdditionalHtml(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  const purifier = getHubHtmlPurifier()
  if (!purifier) return ''
  const sanitized = purifier.sanitize(value, {
    USE_PROFILES: { html: true },
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
  }) as string
  return enforceHubHtmlPolicy(sanitized)
}
