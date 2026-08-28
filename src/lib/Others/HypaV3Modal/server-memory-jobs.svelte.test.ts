import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jobMocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  listJobs: vi.fn(),
  unsubscribe: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

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
        instanceId: 'job-1-instance-a',
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

  it('keeps failed jobs visible with their error and no cancel action', async () => {
    if (component) unmount(component)
    component = undefined
    target.replaceChildren()
    jobMocks.listJobs.mockReset()
    jobMocks.listJobs.mockResolvedValue({
      status: 'ok',
      jobs: [
        {
          id: 'job-failed',
          instanceId: 'job-failed-instance',
          chatId: 'chat-1',
          kind: 'summarize',
          status: 'failed',
          attemptCount: 3,
          maxAttempts: 3,
          error: 'provider authentication failed',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    })
    component = mount(ServerMemoryJobs, { target, props: { chatId: 'chat-1' } })

    await vi.waitFor(() => {
      expect(target.querySelector('[data-memory-job-error]')?.textContent).toContain('provider authentication failed')
    })
    expect(target.querySelector('button[title="Cancel job"]')).toBeNull()
    expect(target.textContent).not.toContain('No pending or running memory jobs.')
  })

  it('keeps a failed cancellation error after the jobs list reconciles successfully', async () => {
    let cancelButton: HTMLButtonElement | null = null
    await vi.waitFor(() => {
      cancelButton = target.querySelector<HTMLButtonElement>('button[title="Cancel job"]')
      expect(cancelButton).toBeTruthy()
    })

    cancelButton?.click()

    await vi.waitFor(() => expect(jobMocks.cancelJob).toHaveBeenCalledWith('job-1'))
    await vi.waitFor(() => expect(jobMocks.listJobs).toHaveBeenCalledTimes(2))
    expect(target.textContent).toContain('not used')
    expect(target.querySelector<HTMLButtonElement>('button[title="Cancel job"]')).toBeTruthy()
  })

  it('shows a newer jobs-refresh error instead of an earlier cancellation error', async () => {
    jobMocks.listJobs.mockResolvedValueOnce({
      status: 'error',
      error: 'jobs reconcile failed',
    })
    let cancelButton: HTMLButtonElement | null = null
    await vi.waitFor(() => {
      cancelButton = target.querySelector<HTMLButtonElement>('button[title="Cancel job"]')
      expect(cancelButton).toBeTruthy()
    })

    cancelButton?.click()

    await vi.waitFor(() => expect(target.textContent).toContain('jobs reconcile failed'))
    expect(target.textContent).not.toContain('not used')
  })

  it('ignores a delayed cancellation response after the logical job is recreated', async () => {
    const cancellation = deferred<{
      status: 'ok'
      job: {
        id: string
        instanceId: string
        chatId: string
        kind: 'summarize'
        status: 'cancelled'
        attemptCount: number
        maxAttempts: number
      }
    }>()
    jobMocks.cancelJob.mockReturnValueOnce(cancellation.promise)
    let cancelButton: HTMLButtonElement | null = null
    await vi.waitFor(() => {
      cancelButton = target.querySelector<HTMLButtonElement>('button[title="Cancel job"]')
      expect(cancelButton).toBeTruthy()
    })
    cancelButton?.click()
    await vi.waitFor(() => expect(jobMocks.cancelJob).toHaveBeenCalledWith('job-1'))

    jobMocks.listJobs.mockResolvedValueOnce({
      status: 'ok',
      jobs: [
        {
          id: 'job-1',
          instanceId: 'job-1-instance-b',
          chatId: 'chat-1',
          kind: 'summarize',
          status: 'running',
          attemptCount: 1,
          maxAttempts: 3,
        },
      ],
    })
    target
      .querySelector<HTMLButtonElement>(`button[aria-label="${language.hypaV3Modal.refreshMemoryJobsAction}"]`)
      ?.click()
    await vi.waitFor(() => expect(jobMocks.listJobs).toHaveBeenCalledTimes(2))

    cancellation.resolve({
      status: 'ok',
      job: {
        id: 'job-1',
        instanceId: 'job-1-instance-a',
        chatId: 'chat-1',
        kind: 'summarize',
        status: 'cancelled',
        attemptCount: 1,
        maxAttempts: 3,
      },
    })

    await vi.waitFor(() => {
      expect(target.textContent).toContain('running')
      expect(target.textContent).not.toContain('cancelled')
      expect(target.querySelector<HTMLButtonElement>('button[title="Cancel job"]')?.disabled).toBe(false)
    })
  })
})
