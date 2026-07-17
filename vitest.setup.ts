import { vi } from 'vitest'
import { safeStructuredClone } from './src/ts/safeStructuredClone'

// Suppress warning
vi.mock(import('katex'), () => ({}))

globalThis.safeStructuredClone = safeStructuredClone
