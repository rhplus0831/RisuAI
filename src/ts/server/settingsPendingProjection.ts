export type PendingSettingsProjectionOverlay = (
  target: Record<string, unknown>,
  allowedKeys?: ReadonlySet<string>,
) => void

const pendingSettingsProjectionOverlays = new Set<PendingSettingsProjectionOverlay>()

export function registerPendingSettingsProjectionOverlay(overlay: PendingSettingsProjectionOverlay): () => void {
  pendingSettingsProjectionOverlays.add(overlay)
  return () => pendingSettingsProjectionOverlays.delete(overlay)
}

export function applyPendingSettingsProjectionOverlays(
  target: Record<string, unknown>,
  allowedKeys?: ReadonlySet<string>,
): void {
  for (const overlay of pendingSettingsProjectionOverlays) overlay(target, allowedKeys)
}
