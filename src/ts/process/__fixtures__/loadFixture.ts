import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DBState, selectedCharID } from '../../stores.svelte'
import { setDatabase, type Database, type character } from '../../storage/database.svelte'

const HERE = dirname(fileURLToPath(import.meta.url))

export interface Fixture {
  /** Optional partial Database overrides merged onto the defaulted base. */
  db?: Partial<Database> & { characters?: character[] }
  /** Which character slot the user has selected. Defaults to 0. */
  selectedCharID?: number
  /** Arguments passed to sendChat(). Subset of the real arg shape. */
  sendChatArgs?: {
    continue?: boolean
    preview?: boolean
    previewPrompt?: boolean
  }
  /**
   * When true, the test driver synthesizes a pre-aborted AbortSignal and
   * passes it as `signal`. Used to pin sendChat's behavior when the caller
   * has already cancelled before the function runs.
   */
  aborted?: boolean
}

export interface LoadedFixture {
  name: string
  fixture: Fixture
  cleanup: () => void
}

/**
 * Load a fixture by name and install it into DBState + selectedCharID.
 * Returns a cleanup() that restores the prior state.
 */
export async function loadFixture(name: string): Promise<LoadedFixture> {
  const path = resolve(HERE, 'db', `${name}.json`)
  const raw = await readFile(path, 'utf8')
  const fixture = JSON.parse(raw) as Fixture

  // Seed with full defaults then overlay the fixture's overrides.
  const seed = (fixture.db ?? {}) as Database
  // setDatabase forcibly resets some web-only fields (e.g. `promptInfoInsideChat`)
  // regardless of caller intent. Capture them up front so we can re-apply
  // post-seed when the fixture explicitly set a value.
  const promptInfoOverride = fixture.db?.promptInfoInsideChat
  const promptTextInfoOverride = fixture.db?.promptTextInfoInsideChat
  setDatabase(seed)
  // setDatabase mutates `seed` in place and assigns it to DBState.db via setDatabaseLite.
  // Characters/chats from the fixture survive because they're carried in `seed`.
  if (promptInfoOverride !== undefined) {
    DBState.db.promptInfoInsideChat = promptInfoOverride
  }
  if (promptTextInfoOverride !== undefined) {
    DBState.db.promptTextInfoInsideChat = promptTextInfoOverride
  }

  const selectId = fixture.selectedCharID ?? 0
  selectedCharID.set(selectId)

  return {
    name,
    fixture,
    cleanup() {
      // Intentionally do not restore the prior DBState/selectedCharID:
      // downstream $effect.root listeners (parser.svelte.ts, stores.svelte.ts)
      // fire reactively on those writes, and tearing them back to `{}` mid-run
      // surfaces as an unhandled error. Each fixture's loadFixture() reseeds
      // DBState wholesale, so leaving stale state between tests is safe.
    },
  }
}
