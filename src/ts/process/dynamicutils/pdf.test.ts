import { beforeEach, describe, expect, it, vi } from 'vitest'

const pdfState = vi.hoisted(() => ({
  destroyAwaited: false,
  getDocument: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfState.getDocument,
}))

vi.mock('pdfjs-dist/build/pdf.worker?worker&url', () => ({
  default: 'pdf-worker.js',
}))

import { convertPdfToImages } from './pdf'

beforeEach(() => {
  vi.clearAllMocks()
  pdfState.destroyAwaited = false
})

describe('convertPdfToImages cleanup', () => {
  it('L54: awaits pdf.destroy() in finally after conversion', async () => {
    const originalCreateElement = document.createElement.bind(document)
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          getContext: () => ({ drawImage: vi.fn() }),
          height: 0,
          toDataURL: () => 'data:image/png;base64,cGRm',
          width: 0,
        } as unknown as HTMLCanvasElement
      }
      return originalCreateElement(tag)
    })
    const page = {
      cleanup: vi.fn(),
      getViewport: vi.fn(() => ({ height: 10, width: 10 })),
      render: vi.fn(() => ({
        cancel: vi.fn(),
        promise: Promise.resolve(),
      })),
    }
    const pdf = {
      destroy: vi.fn(async () => {
        await Promise.resolve()
        pdfState.destroyAwaited = true
      }),
      getPage: vi.fn(async () => page),
      numPages: 1,
    }
    pdfState.getDocument.mockReturnValue({
      destroy: vi.fn(async () => {}),
      promise: Promise.resolve(pdf),
    })

    try {
      await expect(convertPdfToImages(new ArrayBuffer(4))).resolves.toEqual([
        'data:image/png;base64,cGRm',
      ])
      expect(page.cleanup).toHaveBeenCalledTimes(1)
      expect(pdf.destroy).toHaveBeenCalledTimes(1)
      expect(pdfState.destroyAwaited).toBe(true)
    } finally {
      createElement.mockRestore()
    }
  })
})
