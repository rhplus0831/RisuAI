import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jobMocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  listJobs: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('src/ts/process/request/serverMemory', () => ({
  cancelServerMemoryJob: jobMocks.cancelJob,
  listServerMemoryJobs: jobMocks.listJobs,
}))

vi.mock('src/ts/server/memoryJobEvents', () => ({
  subscribeServerMemoryJobEvents: vi.fn(() => jobMocks.unsubscribe),
}))

import ServerMemoryJobs from './server-memory-jobs.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  jobMocks.cancelJob.mockReset()
  jobMocks.cancelJob.mockResolvedValue({ status: 'error', error: 'not used' })
  jobMocks.listJobs.mockReset()
  jobMocks.listJobs.mockResolvedValue({
    status: 'ok',
    jobs: [
      {
        id: 'job-1',
        chatId: 'chat-1',
        kind: 'summarize',
        status: 'running',
        attemptCount: 1,
        maxAttempts: 3,
      },
    ],
  })
  jobMocks.unsubscribe.mockReset()

  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(ServerMemoryJobs, { target, props: { chatId: 'chat-1' } })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('Server memory job keyboard navigation', () => {
  it('keeps refresh and the conditional cancel action in the tab order when enabled', async () => {
    let refreshButton: HTMLButtonElement | null = null
    let cancelButton: HTMLButtonElement | null = null

    await vi.waitFor(() => {
      refreshButton = target.querySelector<HTMLButtonElement>(
        `button[aria-label="${language.hypaV3Modal.refreshMemoryJobsAction}"]`,
      )
      cancelButton = target.querySelector<HTMLButtonElement>('button[title="Cancel job"]')
      expect(refreshButton?.disabled).toBe(false)
      expect(cancelButton?.disabled).toBe(false)
    })

    expect(refreshButton?.tabIndex).toBe(0)
    expect(refreshButton?.title).toBe(language.hypaV3Modal.refreshMemoryJobsAction)
    expect(cancelButton?.tabIndex).toBe(0)
  })
})
