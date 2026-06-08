import { alertError, alertNormal, alertWait } from '../alert'
import {
  createServerBackup,
  exportServerBundle,
  exportServerLocalBackup,
  importServerBundle,
} from '../server/backups'

export async function SaveServerBackup() {
  alertWait('Saving server backup...')
  const result = await createServerBackup({ label: 'Manual backup' })
  if (result.status === 'ok') {
    alertNormal('Server backup saved')
  } else if (result.status === 'error') {
    alertError(result.error)
  }
}

/**
 * Save a complete backup to the user's device in the original Risu local
 * backup format. The bytes come from the server, not browser-local storage.
 */
export async function saveBackupToDevice() {
  alertWait('Saving local backup...')
  const result = await exportServerLocalBackup()
  if (result.status === 'ok') {
    triggerBlobDownload(result.blob, result.filename)
    alertNormal('Local backup saved')
  } else if (result.status === 'error') {
    alertError(result.error)
  }
}

/**
 * Save a complete backup (database + all referenced assets) to the user's
 * device using the newer `.risu.zip` bundle export.
 */
export async function saveZipBackupToDevice() {
  alertWait('Saving ZIP-style local backup...')
  const result = await exportServerBundle()
  if (result.status === 'ok') {
    triggerBlobDownload(result.blob, result.filename)
    alertNormal('Local backup saved')
  } else if (result.status === 'error') {
    alertError(result.error)
  }
}

/**
 * Restore a complete backup the user picks from their device. Both the new
 * `.risu.zip` bundle and the original app's `.bin` local backup are accepted;
 * the file is uploaded to the server, which registers the bundled assets and
 * replaces the database, after which the local projection refreshes.
 */
export async function loadBackupFromDevice() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.zip,.bin,application/zip,application/octet-stream'
  input.onchange = async () => {
    const file = input.files?.[0]
    input.remove()
    if (!file) return

    alertWait('Loading local backup...')
    const result = await importServerBundle({ file, filename: file.name })
    if (result.status === 'ok') {
      alertNormal('Local backup loaded')
    } else if (result.status === 'error') {
      alertError(result.error)
    }
  }
  input.click()
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
