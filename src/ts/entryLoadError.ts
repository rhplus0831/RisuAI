interface EntryLoadErrorOptions {
  documentTarget: Pick<Document, 'createElement' | 'getElementById'>
  message: string
  reloadLabel: string
  onReload: () => void
}

export function renderEntryLoadError(options: EntryLoadErrorOptions): void {
  const preloader = options.documentTarget.getElementById('preloading')
  if (!preloader) return

  preloader.setAttribute('aria-busy', 'false')
  const message = preloader.querySelector<HTMLElement>('[data-risu-preload-message]')
  if (message) message.textContent = options.message
  const detail = preloader.querySelector<HTMLElement>('[data-risu-preload-detail]')
  if (detail) detail.textContent = ''

  if (preloader.querySelector('[data-risu-preload-reload]')) return
  const reload = options.documentTarget.createElement('button')
  reload.type = 'button'
  reload.dataset.risuPreloadReload = 'true'
  reload.className = 'mt-4 rounded-md bg-buttoncolor px-4 py-2 text-buttontext'
  reload.textContent = options.reloadLabel
  reload.addEventListener('click', options.onReload)
  preloader.appendChild(reload)
  reload.focus()
}
