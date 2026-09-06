import { describe, expect, it } from 'vitest'
import * as browserPipeline from '../../../src/ts/translator/pipeline'
import * as sharedPipeline from './translatorPipeline.js'

describe('translator pipeline browser compatibility', () => {
  it('re-exports shared pipeline behavior and contracts by identity', () => {
    for (const key of [
      'buildTranslatorStepMessages',
      'hasMalformedTranslatorHistorySlot',
      'resolveTranslatorPipeline',
      'runTranslatorPipeline',
      'translatorPipelineSignature',
    ] as const) {
      expect(browserPipeline[key]).toBe(sharedPipeline[key])
    }
  })
})
