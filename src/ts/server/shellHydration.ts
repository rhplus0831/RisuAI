import { setAppliedServerResourceRevision } from './commands'
import {
  applyCharactersResource,
  applyShellSettingsResource,
  canApplyCharactersResource,
  canApplyShellSettingsResource,
} from './resourceState.svelte'
import type { ServerShellResourcePayload } from './resourceReads'
import { SERVER_SHELL_PROTOCOL_VERSION } from './shellProtocol'
import { withServerResourceApply } from './resourceWriteGuard.svelte'

/** Apply one already-validated shell response as an atomic client projection. */
export function applyServerShellResource(payload: ServerShellResourcePayload): boolean {
  if (
    payload.protocolVersion !== SERVER_SHELL_PROTOCOL_VERSION ||
    payload.characters.revision !== payload.revision ||
    !canApplyShellSettingsResource({ revision: payload.revision, settings: payload.settings }) ||
    !canApplyCharactersResource(payload.characters)
  ) {
    return false
  }

  const applied = withServerResourceApply(() => {
    const settingsApplied = applyShellSettingsResource({
      revision: payload.revision,
      settings: payload.settings,
    })
    const charactersApplied = applyCharactersResource(payload.characters, {
      preserveResidentChatBodies: false,
    })
    return settingsApplied && charactersApplied
  })
  if (applied) setAppliedServerResourceRevision(payload.revision)
  return applied
}
