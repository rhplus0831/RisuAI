export type ModuleEditorLeaveGuard = () => boolean

const activeModuleEditorLeaveGuards = new Set<ModuleEditorLeaveGuard>()

export function registerModuleEditorLeaveGuard(guard: ModuleEditorLeaveGuard): () => void {
  activeModuleEditorLeaveGuards.add(guard)
  return () => activeModuleEditorLeaveGuards.delete(guard)
}

export function hasActiveModuleEditorLeaveGuard(): boolean {
  return activeModuleEditorLeaveGuards.size > 0
}

export function requestActiveModuleEditorLeave(): boolean {
  for (const guard of [...activeModuleEditorLeaveGuards].reverse()) {
    if (!guard()) return false
  }
  return true
}
