import { describe, expect, it, vi } from 'vitest'
import { getChatVar, getGlobalChatVar, setChatVar, setChatVarBackend } from '../src/prompt/chatVarBackend.js'

describe('Fastify chat variable backend', () => {
  it('fails loudly before the request-local backend is registered', () => {
    expect(() => getChatVar('score')).toThrow('chatVar backend not registered')
    expect(() => setChatVar('score', '1')).toThrow('chatVar backend not registered')
    expect(() => getGlobalChatVar('score')).toThrow('chatVar backend not registered')
  })

  it('passes all operations through to the registered backend', () => {
    const backend = {
      getChatVar: vi.fn(() => 'local-value'),
      setChatVar: vi.fn(),
      getGlobalChatVar: vi.fn(() => 'global-value'),
    }
    setChatVarBackend(backend)

    expect(getChatVar('local')).toBe('local-value')
    setChatVar('local', 'next')
    expect(getGlobalChatVar('global')).toBe('global-value')
    expect(backend.getChatVar).toHaveBeenCalledWith('local')
    expect(backend.setChatVar).toHaveBeenCalledWith('local', 'next')
    expect(backend.getGlobalChatVar).toHaveBeenCalledWith('global')
  })
})
