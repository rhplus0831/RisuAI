import { describe, expect, it } from 'vitest'
import { staticVisibleText } from './staticVisibleText'

describe('static display text', () => {
  it('counts only summaries of closed details and traverses open details', () => {
    const text = staticVisibleText(
      '<p>Hello <b>world</b>.</p><details><summary>Notes</summary>SECRET<details open><summary>Inner</summary>STILL SECRET</details></details><details open><summary>Open</summary><p>Readable</p></details>',
    )
    expect(text).toContain('Hello world.')
    expect(text).toContain('Notes')
    expect(text).toContain('Open')
    expect(text).toContain('Readable')
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('Inner')
  })

  it('excludes hidden content and styles while respecting CSS overrides', () => {
    const text = staticVisibleText(`<style>
      .chattext .hide { display:none }
      .chattext .hide.show { display:block }
      .chattext #always-hidden { display:none !important }
      .chattext .invisible { visibility:hidden }
    </style>
    <p class="hide">HIDDEN</p><p class="hide show">shown</p>
    <p id="always-hidden" style="display:block">HIDDEN</p>
    <p hidden>HIDDEN</p><p style="display:none">HIDDEN</p>
    <p class="invisible">HIDDEN<span style="visibility:visible">visible child</span></p>
    <script>HIDDEN</script><template>HIDDEN</template><p>A &amp; B</p>`)
    expect(text).not.toContain('HIDDEN')
    expect(text).not.toContain('display')
    expect(text).toContain('shown')
    expect(text).toContain('visible child')
    expect(text).toContain('A & B')
  })

  it('preserves text boundaries and preformatted content in a detached document', () => {
    expect(staticVisibleText('<p>one</p><p>two<br>three</p>')).toBe('one\ntwo\nthree')
    expect(staticVisibleText('<pre>first\n  indented</pre>')).toBe('first\n  indented')
    expect(staticVisibleText('<details>collapsed without a summary</details>')).toBe('')
    expect(document.querySelector('.chattext')).toBeNull()
  })
})
