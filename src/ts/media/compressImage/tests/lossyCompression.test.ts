import { afterEach, describe, expect, it, vi } from 'vitest'

import { doLossyCompression } from '../lossyCompression'

type ImageMode = 'load' | 'error'

function stubImage(mode: ImageMode) {
  vi.stubGlobal(
    'Image',
    class {
      height = 100
      width = 200
      onerror: (() => void) | null = null
      onload: (() => void) | null = null

      set src(_value: string) {
        queueMicrotask(() => {
          if (mode === 'load') this.onload?.()
          else this.onerror?.()
        })
      }
    },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('doLossyCompression', () => {
  it('rejects when the browser cannot decode the source image', async () => {
    stubImage('error')

    await expect(doLossyCompression(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      'Unable to decode image for lossy compression',
    )
  })

  it('rejects canvas failures instead of leaving the operation pending', async () => {
    stubImage('load')
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') {
        return { getContext: () => null } as unknown as HTMLCanvasElement
      }
      return originalCreateElement(tagName, options)
    })

    await expect(doLossyCompression(new Uint8Array([1, 2, 3]))).rejects.toThrow('Unable to get 2D context')
  })

  it('uses a valid 75 percent canvas quality value', async () => {
    stubImage('load')
    const drawImage = vi.fn()
    const toDataURL = vi.fn(() => `data:image/webp;base64,${Buffer.from('compressed').toString('base64')}`)
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') {
        return {
          getContext: () => ({ drawImage }),
          height: 0,
          toDataURL,
          width: 0,
        } as unknown as HTMLCanvasElement
      }
      return originalCreateElement(tagName, options)
    })

    await expect(doLossyCompression(new Uint8Array([1, 2, 3]))).resolves.toEqual(Buffer.from('compressed'))
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.75)
  })
})
