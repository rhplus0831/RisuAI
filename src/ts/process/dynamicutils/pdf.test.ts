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

import { convertPdfToImages, extractPdfText } from './pdf'

beforeEach(() => {
  vi.clearAllMocks()
  pdfState.destroyAwaited = false
})

describe('convertPdfToImages cleanup', () => {
  it('awaits pdf.destroy() in finally after conversion', async () => {
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
      await expect(convertPdfToImages(new ArrayBuffer(4))).resolves.toEqual(['data:image/png;base64,cGRm'])
      expect(page.cleanup).toHaveBeenCalledTimes(1)
      expect(pdf.destroy).toHaveBeenCalledTimes(1)
      expect(pdfState.destroyAwaited).toBe(true)
    } finally {
      createElement.mockRestore()
    }
  })

  it('cleans the active page and releases its canvas when rendering fails', async () => {
    const failure = new Error('render failed')
    const canvas = {
      getContext: () => ({ drawImage: vi.fn() }),
      height: 0,
      toDataURL: vi.fn(() => 'data:image/png;base64,cGRm'),
      width: 0,
    } as unknown as HTMLCanvasElement
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(canvas)
    const page = {
      cleanup: vi.fn(),
      getViewport: vi.fn(() => ({ height: 10, width: 20 })),
      render: vi.fn(() => ({ cancel: vi.fn(), promise: Promise.reject(failure) })),
    }
    const pdf = {
      destroy: vi.fn(async () => {}),
      getPage: vi.fn(async () => page),
      numPages: 1,
    }
    pdfState.getDocument.mockReturnValue({
      destroy: vi.fn(async () => {}),
      promise: Promise.resolve(pdf),
    })

    try {
      await expect(convertPdfToImages(new ArrayBuffer(4))).rejects.toBe(failure)
      expect(page.cleanup).toHaveBeenCalledOnce()
      expect(canvas.width).toBe(0)
      expect(canvas.height).toBe(0)
      expect(canvas.toDataURL).not.toHaveBeenCalled()
      expect(pdf.destroy).toHaveBeenCalledOnce()
    } finally {
      createElement.mockRestore()
    }
  })

  it('cleans the active page and releases its canvas when image conversion fails', async () => {
    const failure = new Error('canvas conversion failed')
    const canvas = {
      getContext: () => ({ drawImage: vi.fn() }),
      height: 0,
      toDataURL: vi.fn(() => {
        throw failure
      }),
      width: 0,
    } as unknown as HTMLCanvasElement
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(canvas)
    const page = {
      cleanup: vi.fn(),
      getViewport: vi.fn(() => ({ height: 10, width: 20 })),
      render: vi.fn(() => ({ cancel: vi.fn(), promise: Promise.resolve() })),
    }
    const pdf = {
      destroy: vi.fn(async () => {}),
      getPage: vi.fn(async () => page),
      numPages: 1,
    }
    pdfState.getDocument.mockReturnValue({
      destroy: vi.fn(async () => {}),
      promise: Promise.resolve(pdf),
    })

    try {
      await expect(convertPdfToImages(new ArrayBuffer(4))).rejects.toBe(failure)
      expect(canvas.toDataURL).toHaveBeenCalledOnce()
      expect(page.cleanup).toHaveBeenCalledOnce()
      expect(canvas.width).toBe(0)
      expect(canvas.height).toBe(0)
      expect(pdf.destroy).toHaveBeenCalledOnce()
    } finally {
      createElement.mockRestore()
    }
  })

  it('cancels an active render and cleans its page and canvas when aborted', async () => {
    const controller = new AbortController()
    const abortReason = new DOMException('render cancelled', 'AbortError')
    let rejectRender!: (error: Error) => void
    const renderPromise = new Promise<never>((_resolve, reject) => {
      rejectRender = reject
    })
    const cancel = vi.fn(() => rejectRender(abortReason))
    const canvas = {
      getContext: () => ({ drawImage: vi.fn() }),
      height: 0,
      toDataURL: vi.fn(() => 'data:image/png;base64,cGRm'),
      width: 0,
    } as unknown as HTMLCanvasElement
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(canvas)
    const page = {
      cleanup: vi.fn(),
      getViewport: vi.fn(() => ({ height: 10, width: 20 })),
      render: vi.fn(() => ({ cancel, promise: renderPromise })),
    }
    const pdf = {
      destroy: vi.fn(async () => {}),
      getPage: vi.fn(async () => page),
      numPages: 1,
    }
    const loadingTask = {
      destroy: vi.fn(async () => {}),
      promise: Promise.resolve(pdf),
    }
    pdfState.getDocument.mockReturnValue(loadingTask)

    try {
      const rendering = convertPdfToImages(new ArrayBuffer(4), { signal: controller.signal })
      await vi.waitFor(() => expect(page.render).toHaveBeenCalledOnce())
      controller.abort(abortReason)

      await expect(rendering).rejects.toBe(abortReason)
      expect(cancel).toHaveBeenCalledOnce()
      expect(page.cleanup).toHaveBeenCalledOnce()
      expect(canvas.width).toBe(0)
      expect(canvas.height).toBe(0)
      expect(canvas.toDataURL).not.toHaveBeenCalled()
      expect(pdf.destroy).toHaveBeenCalledOnce()
      expect(loadingTask.destroy).toHaveBeenCalledOnce()
    } finally {
      createElement.mockRestore()
    }
  })
})

describe('extractPdfText cleanup', () => {
  it('cleans every page and awaits document destruction after extraction', async () => {
    const pages = ['first', 'second'].map((str) => ({
      cleanup: vi.fn(),
      getTextContent: vi.fn(async () => ({ items: [{ str }] })),
    }))
    const pdf = {
      destroy: vi.fn(async () => {
        await Promise.resolve()
        pdfState.destroyAwaited = true
      }),
      getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
      numPages: pages.length,
    }
    pdfState.getDocument.mockReturnValue({
      destroy: vi.fn(async () => {}),
      promise: Promise.resolve(pdf),
    })

    await expect(extractPdfText(new ArrayBuffer(4))).resolves.toEqual(['first', 'second'])
    expect(pages[0].cleanup).toHaveBeenCalledOnce()
    expect(pages[1].cleanup).toHaveBeenCalledOnce()
    expect(pdf.destroy).toHaveBeenCalledOnce()
    expect(pdfState.destroyAwaited).toBe(true)
  })

  it('cleans the active page and document when text extraction fails', async () => {
    const failure = new Error('invalid text content')
    const page = {
      cleanup: vi.fn(),
      getTextContent: vi.fn().mockRejectedValue(failure),
    }
    const pdf = {
      destroy: vi.fn(async () => {}),
      getPage: vi.fn(async () => page),
      numPages: 1,
    }
    pdfState.getDocument.mockReturnValue({
      destroy: vi.fn(async () => {}),
      promise: Promise.resolve(pdf),
    })

    await expect(extractPdfText(new ArrayBuffer(4))).rejects.toBe(failure)
    expect(page.cleanup).toHaveBeenCalledOnce()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('destroys a failed loading task when no document was created', async () => {
    const failure = new Error('invalid PDF')
    const loadingTask = {
      destroy: vi.fn(async () => {}),
      promise: Promise.reject(failure),
    }
    pdfState.getDocument.mockReturnValue(loadingTask)

    await expect(extractPdfText(new ArrayBuffer(4))).rejects.toBe(failure)
    expect(loadingTask.destroy).toHaveBeenCalledOnce()
  })
})
