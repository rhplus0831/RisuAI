export interface CharacterFolderOpeningRequest {
  folderId: string
  askBeforeOpening: boolean
  confirm: () => boolean | Promise<boolean>
}

const confirmedFolderIds = new Set<string>()
const pendingConfirmations = new Map<string, Promise<boolean>>()

/**
 * Gate expansion of a protected character folder. Confirmations intentionally
 * live only in module memory, so each browser page asks at most once per folder
 * and a full refresh starts a new confirmation lifetime.
 */
export function canOpenCharacterFolder(request: CharacterFolderOpeningRequest): Promise<boolean> {
  if (!request.askBeforeOpening || confirmedFolderIds.has(request.folderId)) {
    return Promise.resolve(true)
  }

  const pending = pendingConfirmations.get(request.folderId)
  if (pending) return pending

  const confirmation = Promise.resolve()
    .then(request.confirm)
    .then((confirmed) => {
      if (confirmed) confirmedFolderIds.add(request.folderId)
      return confirmed
    })
    .finally(() => {
      pendingConfirmations.delete(request.folderId)
    })

  pendingConfirmations.set(request.folderId, confirmation)
  return confirmation
}
