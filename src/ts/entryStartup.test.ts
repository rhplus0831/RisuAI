import { describe, expect, it, vi } from 'vitest'
import { renderEntryLoadError } from './entryLoadError'
import { startApplicationAfterEnvironment } from './entryStartup'

describe('entry startup', () => {
  it('does not evaluate the application graph until environment installation finishes', async () => {
    let finishEnvironment!: () => void
    const environment = new Promise<void>((resolve) => {
      finishEnvironment = resolve
    })
    const loadApplication = vi.fn(async () => ({ startApplication: () => 'mounted' }))

    const startup = startApplicationAfterEnvironment(() => environment, loadApplication)
    await Promise.resolve()
    expect(loadApplication).not.toHaveBeenCalled()

    finishEnvironment()
    await expect(startup).resolves.toBe('mounted')
    expect(loadApplication).toHaveBeenCalledOnce()
  })

  it('renders one accessible reload action when the entry chunk fails', () => {
    document.body.innerHTML = `
      <div id="preloading" aria-busy="true">
        <span data-risu-preload-message>Loading...</span>
        <span data-risu-preload-detail>Loading Risuai...</span>
      </div>
    `
    const onReload = vi.fn()
    const options = {
      documentTarget: document,
      message: 'Reconnect and reload.',
      reloadLabel: 'Reload',
      onReload,
    }

    renderEntryLoadError(options)
    renderEntryLoadError(options)

    const preloader = document.getElementById('preloading')!
    const reload = preloader.querySelector<HTMLButtonElement>('[data-risu-preload-reload]')!
    expect(preloader.getAttribute('aria-busy')).toBe('false')
    expect(preloader.querySelector('[data-risu-preload-message]')?.textContent).toBe('Reconnect and reload.')
    expect(preloader.querySelector('[data-risu-preload-detail]')?.textContent).toBe('')
    expect(preloader.querySelectorAll('[data-risu-preload-reload]')).toHaveLength(1)
    expect(document.activeElement).toBe(reload)

    reload.click()
    expect(onReload).toHaveBeenCalledOnce()
  })
})
