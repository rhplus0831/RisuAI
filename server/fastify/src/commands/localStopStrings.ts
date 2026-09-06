import { isLocalStopStrings, repairLegacyLocalStopStrings } from '@risuai/shared-core/local-stop-strings'
import { ValidationError } from '../repository.js'

export function normalizePresetLocalStopStrings(record: Record<string, unknown>, label: string): void {
  repairLegacyLocalStopStrings(record)
  if (!isLocalStopStrings(record.localStopStrings)) {
    throw new ValidationError(`${label}.localStopStrings must be an array of strings or null`)
  }
}
