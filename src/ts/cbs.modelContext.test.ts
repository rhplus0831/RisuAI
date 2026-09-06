import { describe, expect, it } from 'vitest'
import { defaultCBSRegisterArg, registerCBS, type CBSModelContext, type RegisterCallback, type matcherArg } from './cbs'
import { ClaudeParameters, LLMFormat, LLMProvider, LLMTokenizer } from './model/types'

const matcherArg = {
  chatID: -1,
  db: null,
  chara: null,
  rmVar: false,
  cbsConditions: {},
} as matcherArg

describe('CBS effective model context', () => {
  it('uses resolved role identity, request metadata, and runtime context', () => {
    const callbacks = new Map<string, RegisterCallback>()
    const main: CBSModelContext = {
      modelId: 'claude-profile-model',
      requestModel: 'claude-wire-model',
      modelInfo: {
        id: 'catalog-model',
        name: 'Resolved Model',
        shortName: 'Resolved',
        format: LLMFormat.Anthropic,
        provider: LLMProvider.Anthropic,
        tokenizer: LLMTokenizer.Claude,
        flags: [],
        parameters: ClaudeParameters,
      },
      maxContext: 12345,
    }
    const auxiliary: CBSModelContext = {
      ...main,
      modelId: 'resolved-aux-model',
      requestModel: 'resolved-aux-wire-model',
    }

    registerCBS({
      ...defaultCBSRegisterArg,
      getDatabase: () =>
        ({ aiModel: 'flat-main', subModel: 'flat-aux', maxContext: 4096 }) as ReturnType<
          typeof defaultCBSRegisterArg.getDatabase
        >,
      getModelContext: (role) => (role === 'chatAux' ? auxiliary : main),
      registerFunction: ({ name, callback }) => {
        if (callback !== 'doc_only') callbacks.set(name, callback)
      },
    })

    const run = (name: string, args: string[] = []) => callbacks.get(name)?.('', matcherArg, args, null)

    expect(run('model')).toBe('claude-profile-model')
    expect(run('axmodel')).toBe('resolved-aux-model')
    expect(run('prefillsupported')).toBe('1')
    expect(run('maxcontext')).toBe('12345')
    expect(run('metadata', ['modelshortname'])).toBe('Resolved')
    expect(run('metadata', ['modelname'])).toBe('Resolved Model')
    expect(run('metadata', ['modelinternalid'])).toBe('claude-wire-model')
    expect(run('metadata', ['modelformat'])).toBe(LLMFormat.Anthropic.toString())
    expect(run('metadata', ['modelprovider'])).toBe(LLMProvider.Anthropic.toString())
    expect(run('metadata', ['modeltokenizer'])).toBe(LLMTokenizer.Claude.toString())
    expect(run('metadata', ['maxcontext'])).toBe('12345')
  })
})
