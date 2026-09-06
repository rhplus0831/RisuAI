import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  beginPostGenerationProgress,
  clearPostGenerationProgress,
  updatePostGenerationProgress,
  type PostGenerationProgressSession,
} from 'src/ts/process/postGenerationProgress'
import PostGenerationScriptProgress from './PostGenerationScriptProgress.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
let session: PostGenerationProgressSession

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  session = beginPostGenerationProgress({ characterId: 'char-1', chatId: 'chat-1' })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  clearPostGenerationProgress()
  target.remove()
})

function publishProgress(status: 'started' | 'running' | 'finished') {
  updatePostGenerationProgress(session, {
    type: 'post_generation_progress',
    phase: 'onOutput',
    status,
    runSeq: 1,
    ownerType: 'module',
    ownerName: 'Translator',
    llmCallCount: status === 'running' ? 1 : 0,
    pendingLlmCount: status === 'running' ? 1 : 0,
    llmCallCounts: { LLM: 0, axLLM: status === 'running' ? 1 : 0 },
    pendingLlmCounts: { LLM: 0, axLLM: status === 'running' ? 1 : 0 },
  })
}

describe('PostGenerationScriptProgress', () => {
  it('only renders progress owned by the mounted chat', async () => {
    publishProgress('running')
    component = mount(PostGenerationScriptProgress, {
      target,
      props: { characterId: 'char-2', chatId: 'chat-2' },
    })
    await tick()
    expect(target.querySelector('[role="status"]')).toBeNull()

    unmount(component)
    component = mount(PostGenerationScriptProgress, {
      target,
      props: { characterId: 'char-1', chatId: 'chat-1' },
    })
    await tick()
    expect(target.querySelector('[role="status"]')).toBeTruthy()
    expect(target.textContent).toContain('Translator')
    expect(target.querySelectorAll('.risu-ongoing-pulse')).toHaveLength(2)

    publishProgress('finished')
    await tick()
    expect(target.querySelector('[role="status"]')).toBeNull()
  })

  it('renders the distinct generated-message translation stage', async () => {
    updatePostGenerationProgress(session, {
      type: 'post_generation_progress',
      phase: 'translation',
      status: 'translating',
      runSeq: 0,
      messageId: 'message-1',
      jobId: 'translation-job-1',
      llmCallCount: 0,
      pendingLlmCount: 0,
      llmCallCounts: { LLM: 0, axLLM: 0 },
      pendingLlmCounts: { LLM: 0, axLLM: 0 },
    })
    component = mount(PostGenerationScriptProgress, {
      target,
      props: { characterId: 'char-1', chatId: 'chat-1' },
    })
    await tick()

    expect(target.querySelector('[role="status"]')).toBeTruthy()
    expect(target.textContent).toContain('Translating generated message')
  })
})
