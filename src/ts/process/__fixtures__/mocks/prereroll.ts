import { recordSideEffect } from '../sideEffects'

export function addRerolls(...args: unknown[]): void {
  recordSideEffect('addRerolls', args)
}
