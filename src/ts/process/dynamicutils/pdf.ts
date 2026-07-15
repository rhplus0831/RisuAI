import * as pdfjs from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?worker&url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

export async function convertPdfToImages(
  pdfBuffer: ArrayBuffer,
  options?: {
    scale?: number
    format?: 'png' | 'jpeg'
    quality?: number
    maxPages?: number
    maxOutputBytes?: number
    signal?: AbortSignal
  },
): Promise<string[]> {
  const { scale = 1.5, format = 'png', quality = 0.8, signal } = options || {}

  const loadingTask = pdfjs.getDocument({
    data: pdfBuffer,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/',
    cMapPacked: true,
  })
  let pdf: Awaited<typeof loadingTask.promise> | null = null
  let activeRenderTask: { promise: Promise<unknown>; cancel?: () => void } | null = null
  let loadingTaskDestroy: Promise<void> | null = null
  let pdfDestroy: Promise<void> | null = null
  const destroyLoadingTask = () => {
    loadingTaskDestroy ??= Promise.resolve(loadingTask.destroy()).then(() => undefined)
    return loadingTaskDestroy
  }
  const destroyPdf = () => {
    if (!pdf) return Promise.resolve()
    pdfDestroy ??= Promise.resolve(pdf.destroy()).then(() => undefined)
    return pdfDestroy
  }
  const abort = () => {
    activeRenderTask?.cancel?.()
    void destroyLoadingTask().catch(() => {
      /* the caller rethrows a clean AbortError */
    })
    void destroyPdf().catch(() => {
      /* the caller rethrows a clean AbortError */
    })
  }
  if (signal?.aborted) {
    abort()
    throw createPdfAbortError(signal)
  }

  signal?.addEventListener('abort', abort, { once: true })
  const images: string[] = []
  let outputBytes = 0

  try {
    pdf = await loadingTask.promise
    throwIfPdfAborted(signal)

    const pageCount = Math.min(pdf.numPages, normalizePdfPageLimit(options?.maxPages, pdf.numPages))

    for (let i = 1; i <= pageCount; i++) {
      throwIfPdfAborted(signal)
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')!

      canvas.height = viewport.height
      canvas.width = viewport.width

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      }

      activeRenderTask = page.render(renderContext)
      try {
        await activeRenderTask.promise
      } catch (error) {
        if (signal?.aborted) {
          throw createPdfAbortError(signal)
        }
        throw error
      } finally {
        activeRenderTask = null
      }

      throwIfPdfAborted(signal)
      const imageData = canvas.toDataURL(`image/${format}`, quality)
      const imageBytes = imageData.length
      if (
        Number.isFinite(options?.maxOutputBytes) &&
        options!.maxOutputBytes! >= 0 &&
        outputBytes + imageBytes > options!.maxOutputBytes!
      ) {
        page.cleanup()
        canvas.width = 0
        canvas.height = 0
        break
      }
      images.push(imageData)
      outputBytes += imageBytes
      page.cleanup()
      canvas.width = 0
      canvas.height = 0
    }
  } catch (error) {
    if (signal?.aborted) {
      throw createPdfAbortError(signal)
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    if (pdf) {
      await destroyPdf().catch(() => {
        /* ignore cleanup failures after rendering has already resolved/rejected */
      })
    } else {
      await destroyLoadingTask().catch(() => {
        /* ignore cleanup failures after rendering has already resolved/rejected */
      })
    }
    if (loadingTaskDestroy) {
      await loadingTaskDestroy.catch(() => {
        /* ignore abort-triggered duplicate cleanup failures */
      })
    }
  }

  return images
}

function normalizePdfPageLimit(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(Math.floor(numeric), fallback)
}

function createPdfAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  if (typeof DOMException !== 'undefined') {
    return new DOMException('PDF rendering aborted', 'AbortError')
  }
  const error = new Error('PDF rendering aborted')
  error.name = 'AbortError'
  return error
}

function throwIfPdfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createPdfAbortError(signal)
  }
}

export async function extractPdfText(pdfBuffer: ArrayBuffer): Promise<string[]> {
  const loadingTask = pdfjs.getDocument({
    data: pdfBuffer,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/',
    cMapPacked: true,
  })
  let pdf: Awaited<typeof loadingTask.promise> | null = null
  const texts: string[] = []

  try {
    pdf = await loadingTask.promise
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      try {
        const content = await page.getTextContent()
        const items = content.items as { str: string }[]

        for (const item of items) {
          texts.push(item.str)
        }
      } finally {
        page.cleanup()
      }
    }
  } finally {
    if (pdf) {
      await Promise.resolve(pdf.destroy()).catch(() => undefined)
    } else {
      await Promise.resolve(loadingTask.destroy()).catch(() => undefined)
    }
  }

  return texts
}
