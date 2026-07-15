import { describe, expect, it, vi } from 'vitest'

vi.mock('./stores.svelte', () => ({}))
vi.mock('./storage/database.svelte', () => ({}))
vi.mock('../lang', () => ({ language: {} }))

describe('alert module imports', () => {
  it('does not access UI stores before an alert helper is used', async () => {
    await expect(import('./alert')).resolves.toBeDefined()
  })
})
