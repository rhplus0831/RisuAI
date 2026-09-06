/**
 * English labels used by browser-smoke assertions. Keep this fixture limited
 * to the labels needed by the smoke journey so the test does not import the
 * browser language bundle into the Fastify test project.
 */
export const browserSmokeEnglish = {
  close: 'Close',
  preloadOfflineError:
    'A part of the app could not load while offline. Your current page is still open; try the action again after the connection returns.',
  preloadStaleError: 'The app has been updated. Refresh the page to load the current version.',
  preloadReload: 'Reload',
  retry: 'Retry',
} as const
