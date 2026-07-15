import DOMPurify from 'dompurify'

const NETWORK_CAPABLE_TAGS = [
  'animate',
  'animatemotion',
  'animatetransform',
  'applet',
  'audio',
  'base',
  'embed',
  'form',
  'frame',
  'iframe',
  'image',
  'img',
  'link',
  'meta',
  'mpath',
  'object',
  'picture',
  'portal',
  'script',
  'set',
  'source',
  'style',
  'track',
  'use',
  'video',
]

const NETWORK_CAPABLE_ATTRIBUTES = [
  'action',
  'background',
  'cite',
  'clip-path',
  'cursor',
  'data',
  'formaction',
  'filter',
  'href',
  'longdesc',
  'manifest',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'ping',
  'poster',
  'src',
  'srcset',
  'style',
  'usemap',
  'xlink:href',
]

const SAFE_STYLE_PROPERTIES = new Set([
  'align-content',
  'align-items',
  'align-self',
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'bottom',
  'box-shadow',
  'box-sizing',
  'color',
  'column-gap',
  'display',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gap',
  'grid-auto-columns',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-column',
  'grid-column-end',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-start',
  'grid-template-columns',
  'grid-template-rows',
  'height',
  'justify-content',
  'justify-items',
  'justify-self',
  'left',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'object-fit',
  'opacity',
  'order',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'pointer-events',
  'position',
  'right',
  'row-gap',
  'text-align',
  'text-decoration',
  'text-overflow',
  'text-transform',
  'top',
  'transform',
  'transform-origin',
  'transition',
  'transition-delay',
  'transition-duration',
  'transition-property',
  'transition-timing-function',
  'user-select',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
  'z-index',
])

const NETWORK_CAPABLE_CSS_VALUE = /(?:@import|url\s*\(|image-set\s*\(|cross-fade\s*\(|element\s*\(|\\|\/\*|\*\/)/i

function normalizeStyleProperty(property: string): string {
  return property
    .trim()
    .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
    .toLowerCase()
}

export function assertPluginNetworkDeadStyle(property: string, value: string): void {
  const normalizedProperty = normalizeStyleProperty(property)
  if (!SAFE_STYLE_PROPERTIES.has(normalizedProperty)) {
    throw new Error(`Plugin CSS property ${property} is not allowed.`)
  }
  if (NETWORK_CAPABLE_CSS_VALUE.test(value)) {
    throw new Error('Plugin CSS cannot contain network-loading values.')
  }
}

export function normalizePluginNetworkDeadStyleAttribute(value: string): string {
  if (NETWORK_CAPABLE_CSS_VALUE.test(value)) {
    throw new Error('Plugin CSS cannot contain network-loading values.')
  }
  const scratch = document.createElement('div')
  scratch.style.cssText = value
  for (const property of Array.from(scratch.style)) {
    assertPluginNetworkDeadStyle(property, scratch.style.getPropertyValue(property))
  }
  return scratch.getAttribute('style') ?? ''
}

export function sanitizePluginNetworkDeadHtml(html: string, stripClass = false): string {
  const forbiddenAttributes = stripClass ? [...NETWORK_CAPABLE_ATTRIBUTES, 'class'] : NETWORK_CAPABLE_ATTRIBUTES
  const sanitized = DOMPurify.sanitize(html, {
    FORBID_TAGS: NETWORK_CAPABLE_TAGS,
    FORBID_ATTR: [...forbiddenAttributes, 'onclick', 'onerror', 'onload', 'onmouseover'],
  })
  const template = document.createElement('template')
  template.innerHTML = sanitized
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (NETWORK_CAPABLE_TAGS.includes(element.localName.toLowerCase())) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      if (
        forbiddenAttributes.includes(attribute.name.toLowerCase()) ||
        /(?:https?:|^\/\/|url\s*\(|\\|\/\*|\*\/)/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return template.innerHTML
}

export function isPluginNetworkCapableTag(tagName: string): boolean {
  return NETWORK_CAPABLE_TAGS.includes(tagName.trim().toLowerCase())
}

export function assertPluginNetworkDeadElementTree(root: Element): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const element of elements) {
    if (isPluginNetworkCapableTag(element.localName)) {
      throw new Error(`Plugin DOM cannot move or clone network-capable <${element.localName}> elements.`)
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name === 'style') {
        normalizePluginNetworkDeadStyleAttribute(attribute.value)
        continue
      }
      if (
        name === 'href' &&
        element.localName === 'a' &&
        element.getAttribute('target') === '_blank' &&
        (element.getAttribute('rel') ?? '').split(/\s+/).includes('noopener') &&
        (element.getAttribute('rel') ?? '').split(/\s+/).includes('noreferrer')
      ) {
        continue
      }
      if (NETWORK_CAPABLE_ATTRIBUTES.includes(name) || /(?:url\s*\(|\\|\/\*|\*\/)/i.test(attribute.value)) {
        throw new Error('Plugin DOM cannot move or clone elements with network-loading attributes.')
      }
    }
  }
}

export function sanitizePluginIconHtml(icon: string): string {
  return sanitizePluginNetworkDeadHtml(icon, true)
}

export function normalizePluginIcon(icon: string, iconType: 'html' | 'img' | 'none'): string {
  if (iconType === 'none' || icon === '') return ''
  if (iconType === 'html') return sanitizePluginIconHtml(icon)
  if (/^blob:/i.test(icon) || /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(icon)) {
    return icon
  }
  throw new Error('Plugin image icons must use a local blob URL or a base64 raster data URL.')
}
