import { alertError, alertNormal, alertWait } from '../alert'
import { createServerBackup } from '../server/backups'

export async function SaveServerBackup() {
  alertWait('Saving server backup...')
  const result = await createServerBackup({ label: 'Manual backup' })
  if (result.status === 'ok') {
    alertNormal('Server backup saved')
  } else if (result.status === 'error') {
    alertError(result.error)
  }
}
