/**
 * Give the browser a chance to paint the settled transcript before starting a
 * best-effort completion effect. Chromium's scheduler yield is task-aware; the
 * microtask fallback preserves compatibility without introducing timer races.
 */
export async function yieldBeforeCompletionEffect(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === 'function') {
    await scheduler.yield()
    return
  }
  await Promise.resolve()
}
