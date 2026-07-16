import { alertError } from 'src/ts/alert'
import { importPlugin } from '../plugins.svelte'

const HOT_RELOAD_INTERVAL_MS = 500

export interface PluginHotReloadSession {
  readonly done: Promise<void>
  stop(): void
}

let activeHotReloadSession: PluginHotReloadSessionImpl | null = null

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }

    timer = setTimeout(finish, HOT_RELOAD_INTERVAL_MS)
    signal.addEventListener('abort', finish, { once: true })
  })
}

async function runHotReloadSession(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return

  if (!('showOpenFilePicker' in window)) {
    if (!signal.aborted) {
      alertError(
        'Your browser does not support the File System Access API, which is required for hot-reloading plugin files.',
      )
    }
    return
  }

  let fileHandle: FileSystemFileHandle
  try {
    ;[fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'JavaScript or TypeScript Plugin File',
          accept: {
            'text/typescript': ['.ts'],
            'application/javascript': ['.js'],
          },
        },
      ],
    })
  } catch {
    return
  }

  if (signal.aborted || !fileHandle) return

  let lastModified = 0
  while (!signal.aborted) {
    try {
      const file = await fileHandle.getFile()
      if (signal.aborted) return

      if (file.lastModified !== lastModified) {
        lastModified = file.lastModified
        const content = await file.text()
        if (signal.aborted) return

        console.log('Detected change in plugin file, reloading...')
        await importPlugin(content, {
          isHotReload: true,
          isUpdate: true,
          isTypescript: file.name.endsWith('.ts'),
        })
        if (signal.aborted) return
      }
    } catch (error) {
      if (signal.aborted) return
      console.error('Error reading file:', error)
    }

    await waitForNextPoll(signal)
  }
}

class PluginHotReloadSessionImpl implements PluginHotReloadSession {
  readonly #controller = new AbortController()
  readonly done: Promise<void>

  constructor() {
    this.done = Promise.resolve()
      .then(() => runHotReloadSession(this.#controller.signal))
      .finally(() => {
        if (activeHotReloadSession === this) activeHotReloadSession = null
      })
  }

  stop(): void {
    this.#controller.abort()
    if (activeHotReloadSession === this) activeHotReloadSession = null
  }
}

export function hotReloadPluginFiles(): PluginHotReloadSession {
  activeHotReloadSession?.stop()

  const session = new PluginHotReloadSessionImpl()
  activeHotReloadSession = session
  return session
}
