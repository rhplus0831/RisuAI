import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mirrors serverCompletion.test.ts: the platform gate is a hoisted getter so a
// case can flip Fastify mode, and `../../modules` is mocked so getModuleTriggers
// is hermetic (no enabled-module state leaks into the content detector).
vi.mock('../../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  // `moduleUpdate`/`getModuleToggles` are neutralized as in serverCompletion.test.ts
  // (a stores `$effect` calls moduleUpdate at import and otherwise races the db
  // module's init); `getModuleTriggers` is emptied so module triggers don't leak
  // into the content detector.
  return {
    ...actual,
    moduleUpdate: () => {},
    getModuleToggles: () => '',
    getModuleTriggers: () => [],
  }
})

import { setDatabase, type character, type Chat, type Database } from '../../../storage/database.svelte'
import { LLMFlags } from '../../../model/modellist'
import { pluginV2 } from '../../../plugins/plugins.svelte'
import {
  resolveServerPromptAssembly,
  type ServerPromptAssemblyInput,
  type ServerPromptAssemblyRoute,
} from '../serverPromptAssembly'

function seedDb(overrides: Partial<Database> = {}): void {
  setDatabase({
    aiModel: 'echo_model',
    subModel: 'echo_model',
    characters: [],
    maxContext: 4000,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    echoMessage: 'Echo Message',
    echoDelay: 0,
    koboldURL: '',
    textgenWebUIBlockingURL: '',
    ...overrides,
  } as unknown as Database)
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'char-1',
    triggerscript: [],
    ...overrides,
  } as unknown as character
}

function makeChat(
  message: Array<{ role: string; data: string; [k: string]: unknown }> = [{ role: 'user', data: 'hi' }],
): Chat {
  return { message } as unknown as Chat
}

function makeInput(overrides: Partial<ServerPromptAssemblyInput> = {}): ServerPromptAssemblyInput {
  return { currentChar: makeChar(), currentChat: makeChat(), ...overrides }
}

function expectUnsupported(route: ServerPromptAssemblyRoute): string {
  expect(route.type).toBe('unsupported')
  if (route.type !== 'unsupported') throw new Error('expected an unsupported verdict')
  expect(route.reason.length).toBeGreaterThan(0)
  return route.reason
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = (v: unknown) =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v))
  seedDb()
})

afterEach(() => {
  // The pluginV2 registry is a module singleton; a content case adds to it.
  pluginV2.editinput.clear()
  pluginV2.editoutput.clear()
  pluginV2.editprocess.clear()
  pluginV2.editdisplay.clear()
  pluginV2.replacerbeforeRequest.clear()
  pluginV2.replacerafterRequest.clear()
})

describe('resolveServerPromptAssembly', () => {
  describe('server — the supported pure-text-send subset', () => {
    it('routes a plain user-message send to server', () => {
      expect(resolveServerPromptAssembly(makeInput())).toEqual({ type: 'server' })
    })

    it('uses the chat-selected model preset for provider preflight', () => {
      seedDb({
        aiModel: 'novelai',
        modelPresets: [{ id: 'model-chat', name: 'Chat Model', aiModel: 'echo_model' }],
        promptPresets: [{ id: 'prompt-chat', name: 'Chat Prompt' }],
      } as never)
      const input = makeInput({
        currentChat: {
          ...makeChat(),
          generationSettings: {
            configured: true,
            modelPresetId: 'model-chat',
            promptPresetId: 'prompt-chat',
          },
        } as Chat,
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    it('routes continue (no user-message structural requirement) to server', () => {
      const input = makeInput({
        continue: true,
        currentChat: makeChat([{ role: 'char', data: 'previous reply' }]),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    it('routes regenerate to server', () => {
      const input = makeInput({
        regenerateMessageId: 'msg-char-1',
        currentChat: makeChat([{ role: 'char', data: 'previous reply' }]),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    it('routes preview to server', () => {
      expect(resolveServerPromptAssembly(makeInput({ preview: true }))).toEqual({ type: 'server' })
    })

    it('routes preview_prompt to server', () => {
      expect(resolveServerPromptAssembly(makeInput({ previewPrompt: true }))).toEqual({
        type: 'server',
      })
    })

    // With an image-input model, the server assembler resolves inlay / asset /
    // runtime-multimodal bytes, so this routes to `server`. echo_model lacks
    // image input, so the vision flag is forced on via customFlags while keeping
    // the server-routable Echo format.
    function seedVisionDb(): void {
      seedDb({ enableCustomFlags: true, customFlags: [LLMFlags.hasImageInput] })
    }

    it('routes an inlay-marker send to server on an image-input model (slice 3a)', () => {
      seedVisionDb()
      const input = makeInput({
        currentChat: makeChat([{ role: 'user', data: 'see {{inlayed::img1}}' }]),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    it('uses image-input flags from the chat-selected model preset', () => {
      seedDb({
        enableCustomFlags: false,
        customFlags: [],
        modelPresets: [
          {
            id: 'model-vision',
            name: 'Vision Model',
            aiModel: 'echo_model',
            enableCustomFlags: true,
            customFlags: [LLMFlags.hasImageInput],
          },
        ],
        promptPresets: [{ id: 'prompt-chat', name: 'Chat Prompt' }],
      } as never)
      const input = makeInput({
        currentChat: {
          ...makeChat([{ role: 'user', data: 'see {{inlayed::img1}}' }]),
          generationSettings: {
            configured: true,
            modelPresetId: 'model-vision',
            promptPresetId: 'prompt-chat',
          },
        } as Chat,
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    it('routes an asset_prompt send to server on an image-input model (slice 3a)', () => {
      seedVisionDb()
      const input = makeInput({
        currentChat: makeChat([{ role: 'user', data: 'show {{asset_prompt::icon}}' }]),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    it('routes a runtime-multimodals send to server on an image-input model (slice 3a)', () => {
      seedVisionDb()
      const input = makeInput({
        currentChat: makeChat([{ role: 'user', data: 'hi', multimodals: [{ type: 'image', base64: 'x' }] }]),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    // The server Lua VM runs the editRequest hook, so a non-interactive
    // `triggerlua` char routes `server` instead of hard-failing.
    it('routes a non-interactive Lua trigger char to server (slice 3b)', () => {
      const input = makeInput({
        currentChar: makeChar({
          triggerscript: [
            {
              effect: [
                {
                  type: 'triggerlua',
                  code: "listenEdit('editRequest', function(id, data) return data end)",
                },
              ],
            },
          ],
        } as never),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    // An editprocess-only Lua char (no editRequest handler, no interactive dialog
    // API) routes `server`; the editprocess hook is wired through the runtime as
    // a browser no-op. The classifier cannot tell which edit mode a script hooks,
    // so this pins that the editprocess sub-class stays `server`.
    it('routes an editprocess-only Lua trigger char to server (slice 3b)', () => {
      const input = makeInput({
        currentChar: makeChar({
          triggerscript: [
            {
              effect: [
                {
                  type: 'triggerlua',
                  code: 'function editprocess(id) return getChatMain(id, 0) end',
                },
              ],
            },
          ],
        } as never),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    // A submit-time input-trigger / `editinput` Lua char (no interactive dialog
    // API) routes `server`; the server runs both the `onInput` trigger and the
    // `editInput` hook before assembly.
    it('routes an input-trigger / editinput Lua char to server (slice 3b-4)', () => {
      const input = makeInput({
        currentChar: makeChar({
          triggerscript: [
            {
              effect: [
                {
                  type: 'triggerlua',
                  code: "function onInput(id) addChat(id, 'char', 'x') end\nlistenEdit('editInput', function(id, data) return data end)",
                },
              ],
            },
          ],
        } as never),
      })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })

    // The image-gen / emotion view instruction is server-assembled, so a char with
    // `inlayViewScreen` set routes `server`. Post-gen image generation / inlay
    // rendering stays a browser effect; only the instruction text moved.
    it('routes a char with an image-gen view instruction to server (slice 3c)', () => {
      const input = makeInput({ currentChar: makeChar({ inlayViewScreen: true } as never) })
      expect(resolveServerPromptAssembly(input)).toEqual({ type: 'server' })
    })
  })

  describe('unsupported — hard-fail, never a silent local fallback', () => {
    it('rejects a send whose last message is not a user message (the old silent unavailable)', () => {
      const input = makeInput({ currentChat: makeChat([{ role: 'char', data: 'bot turn' }]) })
      expectUnsupported(resolveServerPromptAssembly(input))
    })

    it('rejects a send with no messages', () => {
      const input = makeInput({ currentChat: makeChat([]) })
      expectUnsupported(resolveServerPromptAssembly(input))
    })

    it('rejects a group character (legacy; explicit unsupported signal)', () => {
      const input = makeInput({ currentChar: makeChar({ type: 'group' } as never) })
      expectUnsupported(resolveServerPromptAssembly(input))
    })

    it('rejects a non-server-routable provider and surfaces the completion-route reason', () => {
      seedDb({ aiModel: 'novelai' })
      const reason = expectUnsupported(resolveServerPromptAssembly(makeInput()))
      expect(reason).toContain('novelai')
    })

    it('rejects an unknown OpenAI-compatible id before treating it as a server-routable provider', () => {
      seedDb({ aiModel: 'unregistered-local-model', openAIKey: 'sk-server-owned' })
      expect(expectUnsupported(resolveServerPromptAssembly(makeInput()))).toBe(
        'unsupported /chat provider: unknown OpenAI-compatible model "unregistered-local-model" cannot be dispatched by the server',
      )
    })

    // One case per unsupported content class.
    //
    // Non-vision caption case: the seeded echo_model lacks image input, so
    // image/asset/inlay content still hard-fails because the browser's
    // runImageEmbedding caption fallback has no server equivalent.
    it('rejects an inlay marker on a model without image input — caption case (slice 3a class 2)', () => {
      const input = makeInput({
        currentChat: makeChat([{ role: 'user', data: 'see {{inlayed::img1}}' }]),
      })
      expect(expectUnsupported(resolveServerPromptAssembly(input))).toMatch(/image input/i)
    })

    it('rejects an asset_prompt marker on a model without image input (slice 3a class 2)', () => {
      const input = makeInput({
        currentChat: makeChat([{ role: 'user', data: 'show {{asset_prompt::icon}}' }]),
      })
      expectUnsupported(resolveServerPromptAssembly(input))
    })

    it('rejects a runtime multimodals array on a model without image input (slice 3a class 2)', () => {
      const input = makeInput({
        currentChat: makeChat([{ role: 'user', data: 'hi', multimodals: [{ type: 'image', base64: 'x' }] }]),
      })
      expectUnsupported(resolveServerPromptAssembly(input))
    })

    // Lua and plugin detectors have distinct dispositions and reasons. Lua routes
    // `server` except when scripts use an interactive dialog API, which stays
    // `unsupported` (no server browser dialog). The pluginV2 arm is a permanent
    // hard fail (server-side plugin code execution is on the no-port list and
    // pluginV2 is superseded by Plugin V3).
    it('rejects a Lua trigger that uses an interactive dialog API (slice 3b)', () => {
      const input = makeInput({
        currentChar: makeChar({
          triggerscript: [
            {
              effect: [
                {
                  type: 'triggerlua',
                  code: "listenEdit('editRequest', function(id, data) alertInput(id, 'pick') return data end)",
                },
              ],
            },
          ],
        } as never),
      })
      const reason = expectUnsupported(resolveServerPromptAssembly(input))
      expect(reason).toMatch(/lua/i)
      expect(reason).toMatch(/interactive|alertInput/i)
    })

    it('rejects a non-empty pluginV2 edit set with the plugin (permanent) reason (slice 3b)', () => {
      pluginV2.editprocess.add((() => {}) as never)
      const reason = expectUnsupported(resolveServerPromptAssembly(makeInput()))
      expect(reason).toMatch(/plugin/i)
      // The permanent plugin arm is not the (interactive) Lua arm.
      expect(reason).not.toMatch(/lua/i)
    })

    it('a non-interactive Lua trigger no longer blocks a pluginV2 set — plugin reason surfaces (slice 3b)', () => {
      pluginV2.editprocess.add((() => {}) as never)
      const input = makeInput({
        currentChar: makeChar({
          triggerscript: [
            {
              effect: [
                {
                  type: 'triggerlua',
                  code: "listenEdit('editRequest', function(id, data) return data end)",
                },
              ],
            },
          ],
        } as never),
      })
      // The Lua arm passes (non-interactive → server-capable), so the permanent
      // pluginV2 hard fail is what reports.
      const reason = expectUnsupported(resolveServerPromptAssembly(input))
      expect(reason).toMatch(/plugin/i)
    })

    it('reports the interactive-Lua arm before pluginV2 when a char has both (slice 3b)', () => {
      pluginV2.editprocess.add((() => {}) as never)
      const input = makeInput({
        currentChar: makeChar({
          triggerscript: [
            {
              effect: [
                {
                  type: 'triggerlua',
                  code: "listenEdit('editRequest', function(id, data) alertSelect(id, 'x') return data end)",
                },
              ],
            },
          ],
        } as never),
      })
      // Interactive Lua is checked before pluginV2, so its reason wins. Only the
      // interactive-Lua reason mentions "interactive"; the plugin reason does not.
      const reason = expectUnsupported(resolveServerPromptAssembly(input))
      expect(reason).toMatch(/interactive/i)
    })
  })
})
