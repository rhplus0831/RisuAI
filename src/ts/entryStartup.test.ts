import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderEntryLoadError } from './entryLoadError'
import { startApplicationAfterEnvironment } from './entryStartup'

const entryDependencyIds = [
  '../appStartup',
  '../lang',
  './alert',
  './entryLoadError',
  './polyfill',
  './startupReadiness',
] as const

afterEach(() => {
  for (const dependency of entryDependencyIds) vi.doUnmock(dependency)
  vi.resetModules()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mockActualEntryDependencies(options: { applicationFactory?: () => unknown } = {}) {
  const order: string[] = []
  const alert = vi.fn()
  const render = vi.fn()
  const milestone = vi.fn()
  vi.doMock('../lang', () => ({
    language: {
      preloadOfflineError: 'Offline entry failure',
      preloadReload: 'Reload',
      preloadStaleError: 'Stale entry failure',
    },
  }))
  vi.doMock('./alert', () => ({ alertError: alert }))
  vi.doMock('./entryLoadError', () => ({ renderEntryLoadError: render }))
  vi.doMock('./polyfill', () => ({
    installRuntimeEnvironment: vi.fn(async () => {
      order.push('environment')
    }),
  }))
  vi.doMock('./startupReadiness', () => ({ recordStartupMilestone: milestone }))
  vi.doMock('../appStartup', () => {
    if (options.applicationFactory) return options.applicationFactory()
    return {
      startApplication: vi.fn(() => {
        order.push('application')
        return 'mounted'
      }),
    }
  })
  return { alert, milestone, order, render }
}

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

  it('wires the actual entry to install the environment before dynamically starting the app', async () => {
    const dependencies = mockActualEntryDependencies()
    const addEventListener = vi.spyOn(window, 'addEventListener')

    const entry = await import('../main')

    await expect(entry.default).resolves.toBe('mounted')
    expect(dependencies.order).toEqual(['environment', 'application'])
    expect(dependencies.milestone).toHaveBeenCalledWith('entry', 0)
    expect(addEventListener).toHaveBeenCalledWith('vite:preloadError', expect.any(Function))
  })

  it('routes an actual dynamic application import failure to the entry error surface', async () => {
    const failure = new Error('entry chunk missing')
    const dependencies = mockActualEntryDependencies({
      applicationFactory: () => {
        throw failure
      },
    })
    document.body.innerHTML = '<div id="preloading"></div>'

    const entry = await import('../main')

    await expect(entry.default).resolves.toBeNull()
    expect(dependencies.alert).toHaveBeenCalledWith('Stale entry failure')
    expect(dependencies.render).toHaveBeenCalledWith(
      expect.objectContaining({
        documentTarget: document,
        message: 'Stale entry failure',
        reloadLabel: 'Reload',
      }),
    )
  })
})
