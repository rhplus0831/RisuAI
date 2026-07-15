import { describe, expect, it } from 'vitest'
import DOMPurify from 'dompurify'
import { sanitizeHubAdditionalHtml } from './hubAdditionalHtml'

function sanitizedDocument(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

describe('sanitizeHubAdditionalHtml', () => {
  it('removes executable and document-controlling Hub content', () => {
    const sanitized = sanitizeHubAdditionalHtml(`
      <section id="notice" class="hub-notice" style="position:fixed" onclick="globalThis.pwned = true">
        <script>globalThis.pwned = true</script>
        <iframe srcdoc="<script>globalThis.pwned = true</script>"></iframe>
        <form action="/api/v1/auth/logout"><input name="password"></form>
        <a href="javascript:globalThis.pwned=true">unsafe link</a>
        <img src="x" onerror="globalThis.pwned = true">
      </section>
    `)
    const fragment = sanitizedDocument(sanitized)

    expect(fragment.querySelector('script, iframe, form, input')).toBeNull()
    expect(fragment.querySelector('section')?.getAttribute('onclick')).toBeNull()
    expect(fragment.querySelector('section')?.getAttribute('style')).toBeNull()
    expect(fragment.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(fragment.querySelector('img')?.getAttribute('onerror')).toBeNull()
    expect(fragment.querySelector('section')?.id).toBe('user-content-notice')
  })

  it('preserves safe announcement markup without applying global parser hooks', () => {
    const globalHook = (_node: Element, data: { attrName: string; attrValue: string }) => {
      if (data.attrName === 'class') data.attrValue = `global-${data.attrValue}`
    }
    DOMPurify.addHook('uponSanitizeAttribute', globalHook)
    try {
      const sanitized = sanitizeHubAdditionalHtml(
        '<aside class="hub-banner"><strong>Update</strong> <a href="https://risuai.net/news">Details</a></aside>',
      )
      const fragment = sanitizedDocument(sanitized)

      expect(fragment.querySelector('aside')?.hasAttribute('class')).toBe(false)
      expect(fragment.querySelector('strong')?.textContent).toBe('Update')
      expect(fragment.querySelector('a')?.getAttribute('href')).toBe('https://risuai.net/news')
    } finally {
      DOMPurify.removeHook('uponSanitizeAttribute', globalHook)
    }
  })

  it('fails closed for non-string values', () => {
    expect(sanitizeHubAdditionalHtml(undefined)).toBe('')
    expect(sanitizeHubAdditionalHtml({ html: '<strong>no</strong>' })).toBe('')
  })

  it('strips utility classes that could turn Hub content into a full-screen overlay', () => {
    const sanitized = sanitizeHubAdditionalHtml(
      '<section class="fixed inset-0 z-[100] h-full w-full bg-black">Deceptive overlay</section>',
    )
    const section = sanitizedDocument(sanitized).querySelector('section')

    expect(section?.textContent).toBe('Deceptive overlay')
    expect(section?.hasAttribute('class')).toBe(false)
  })
})
