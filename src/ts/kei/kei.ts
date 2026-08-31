import { hubURL } from '../characterCards'
import { settingsResourceState } from '../server/resourceState.svelte'
import { getDatabase } from '../storage/database.svelte'

export function keiServerURL() {
  const status = settingsResourceState.groupStatuses.advanced ?? settingsResourceState.status
  if (status !== 'error' && settingsResourceState.status !== 'error') {
    const ownerValue = settingsResourceState.value.keiServerURL
    if (typeof ownerValue === 'string' && ownerValue) return ownerValue

    // Public/bootstrap compatibility seam: before any settings owner exists,
    // retain the historical aggregate override. Refresh errors never use it.
    if (
      (status === 'idle' || status === 'loading') &&
      (settingsResourceState.status === 'idle' || settingsResourceState.status === 'loading')
    ) {
      const compatibilityValue = getDatabase().keiServerURL
      if (compatibilityValue) return compatibilityValue
    }
  }
  return hubURL + '/kei'
}
