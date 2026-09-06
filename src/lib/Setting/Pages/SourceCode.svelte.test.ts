import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { language } from 'src/lang'
import SourceCode from './SourceCode.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(SourceCode, { target })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('SourceCode repository links', () => {
  it('distinguishes the original project from this fork and opens both repositories safely', () => {
    const links = Array.from(target.querySelectorAll<HTMLAnchorElement>('a'))

    expect(target.querySelector('[data-risu-source-code]')).toBeTruthy()
    expect(target.textContent).toContain(language.sourceCodeOriginalDescription)
    expect(target.textContent).toContain(language.sourceCodeForkDescription)
    expect(
      links.map((link) => ({
        href: link.getAttribute('href'),
        label: link.getAttribute('aria-label'),
        target: link.target,
        rel: link.rel,
      })),
    ).toEqual([
      {
        href: 'https://github.com/kwaroran/RisuAI',
        label: language.openSourceCodeRepository(language.sourceCodeOriginalName),
        target: '_blank',
        rel: 'nofollow noopener noreferrer',
      },
      {
        href: 'https://github.com/rhplus0831/risuai-fastify',
        label: language.openSourceCodeRepository(language.sourceCodeForkName),
        target: '_blank',
        rel: 'nofollow noopener noreferrer',
      },
    ])
  })
})
