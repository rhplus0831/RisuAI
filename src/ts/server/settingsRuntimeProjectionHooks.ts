export type SettingsRuntimeProjectionHook = (keys: readonly string[]) => void

let hook: SettingsRuntimeProjectionHook | null = null

export function setSettingsRuntimeProjectionHook(nextHook: SettingsRuntimeProjectionHook | null): void {
  hook = nextHook
}

export function applySettingsRuntimeProjectionEffects(keys: readonly string[]): void {
  if (!hook || keys.length === 0) return
  try {
    hook(keys)
  } catch (error) {
    console.warn('Settings runtime projection effect failed', error)
  }
}
