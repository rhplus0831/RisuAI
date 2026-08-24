import { beforeEach, vi } from 'vitest'
import { safeStructuredClone } from './src/ts/safeStructuredClone'
import {
  recordStartupMilestone,
  resetStartupReadinessForTests,
  settleStartupChatReadiness,
} from './src/ts/startupReadiness'

// Suppress warning
vi.mock(import('katex'), () => ({}))

globalThis.safeStructuredClone = safeStructuredClone

// Most unit tests exercise post-startup domain behavior. Default those tests
// to a fully ready coordinator; readiness-focused suites reset or establish
// narrower milestones in their own beforeEach hooks.
beforeEach(() => {
  resetStartupReadinessForTests()
  for (const milestone of [
    'entry',
    'shell-mounted',
    'observer-ready',
    'writer-ready',
    'plugins-ready',
    'chat-ready',
    'background-ready',
  ] as const) {
    recordStartupMilestone(milestone)
  }
  settleStartupChatReadiness(true)
})
