import { setAppliedServerResourceRevision } from './commands'
import {
  applyCharactersResource,
  applyShellSettingsResource,
  canApplyCharactersResource,
  canApplyShellSettingsResource,
} from './resourceState.svelte'
import type { ServerShellResourcePayload } from './resourceReads'
import { SERVER_SHELL_PROTOCOL_VERSION } from '@risuai/protocol/shell-resource'

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

  const settingsApplied = applyShellSettingsResource({
    revision: payload.revision,
    settings: payload.settings,
  })
  const charactersApplied = applyCharactersResource(payload.characters, {
    preserveResidentChatBodies: false,
  })
  const applied = settingsApplied && charactersApplied
  if (applied) setAppliedServerResourceRevision(payload.revision)
  return applied
}
