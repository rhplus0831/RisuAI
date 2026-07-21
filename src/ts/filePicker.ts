import { isIOS } from './platform'
import { getDatabase } from './storage/database.svelte'

export interface SelectSingleFileOptions {
  onFileSelected?: (file: File) => void
}

export interface SelectMultipleFileOptions {
  onFilesSelected?: (files: File[]) => void
}

export async function selectSingleFile(ext: string[], options: SelectSingleFileOptions = {}) {
  const v = await selectFileByDom(ext, 'single')
  const file = v?.[0]
  if (!file) {
    return null
  }
  options.onFileSelected?.(file)
  return { name: file.name, data: await readFileAsUint8Array(file) }
}

export async function selectMultipleFile(ext: string[], options: SelectMultipleFileOptions = {}) {
  const v = await selectFileByDom(ext, 'multiple')
  const files = v ?? []
  if (files.length > 0) {
    options.onFilesSelected?.(files)
  }
  const arr: { name: string; data: Uint8Array }[] = []
  for (const file of files) {
    arr.push({ name: file.name, data: await readFileAsUint8Array(file) })
  }
  return arr
}

export function selectFileByDom(allowedExtensions: string[], multiple: 'multiple' | 'single' = 'single') {
  return new Promise<null | File[]>((resolve) => {
    const fileInput = document.createElement('input')
    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      fileInput.remove()
      resolve(files)
    }
    fileInput.type = 'file'
    fileInput.multiple = multiple === 'multiple'
    const acceptAll = getDatabase().allowAllExtentionFiles || isIOS() || allowedExtensions[0] === '*'
    if (!acceptAll) {
      if (allowedExtensions && allowedExtensions.length) {
        fileInput.accept = allowedExtensions.map((ext) => `.${ext}`).join(',')
      }
    } else {
      fileInput.accept = '*'
    }

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length === 0) {
        finish([])
        return
      }

      const files = acceptAll
        ? Array.from(fileInput.files)
        : Array.from(fileInput.files).filter((file) => {
            const fileExtension = file.name.split('.').pop().toLowerCase()
            return !allowedExtensions || allowedExtensions.includes(fileExtension)
          })

      finish(files)
    })
    // Native file inputs do not emit `change` when the chooser is cancelled.
    // Settle explicitly so callers can release their loading state and the
    // hidden input does not accumulate in the document.
    fileInput.addEventListener('cancel', () => finish([]))

    document.body.appendChild(fileInput)
    fileInput.click()
    fileInput.style.display = 'none' // Hide the file input element
  })
}

function readFileAsUint8Array(file: File) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (event) => {
      const buffer = event.target.result
      const uint8Array = new Uint8Array(buffer as ArrayBuffer)
      resolve(uint8Array)
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file', { cause: reader.error }))
    }

    reader.readAsArrayBuffer(file)
  })
}
