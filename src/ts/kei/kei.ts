import { hubURL } from '../characterCards'
import { settingsResourceState } from '../server/resourceState.svelte'

export function keiServerURL() {
  const status = settingsResourceState.groupStatuses.advanced ?? settingsResourceState.status
  if (status === 'ready' && settingsResourceState.status !== 'error') {
    const ownerValue = settingsResourceState.value.keiServerURL
    if (typeof ownerValue === 'string' && ownerValue) return ownerValue
  }
  return hubURL + '/kei'
}
