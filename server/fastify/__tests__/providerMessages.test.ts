import { describe, expect, it } from 'vitest'
import { LLMFlags } from '../../../src/ts/model/types'
import {
  buildAnthropicWireMessages,
  buildOpenAIWireMessages,
  sanitizeTextMessages,
} from '../src/generation/providerMessages.js'
import { reformatForGemini } from '../src/generation/gemini.js'
import { buildResponseInput } from '../src/generation/openaiResponses.js'

describe('provider-native message conversion', () => {
  it('removes internal prompt metadata and converts OpenAI image input', () => {
    const messages = buildOpenAIWireMessages(
      [
        {
          role: 'system',
          content: '[Start a new chat]',
          memo: 'NewChat',
          removable: true,
          attr: ['internal'],
          thoughts: ['hidden'],
          cachePoint: true,
        },
        {
          role: 'user',
          content: 'describe it',
          memo: 'history',
          removable: true,
          attr: ['internal'],
          multimodals: [{ type: 'image', base64: 'data:image/png;base64,AAAA' }],
          thoughts: ['must not leak'],
          cachePoint: true,
        },
      ],
      { flags: [LLMFlags.hasFullSystemPrompt], visionQuality: 'high' },
    )

    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' } },
          { type: 'text', text: 'describe it' },
        ],
      },
    ])
    expect(JSON.stringify(messages)).not.toMatch(/memo|removable|attr|multimodals|thoughts|cachePoint/u)
  })

  it('keeps only legal text fields for text-only providers', () => {
    expect(
      sanitizeTextMessages([
        { role: 'user', content: 'hello', memo: 'x', removable: true, attr: ['x'], cachePoint: true },
      ]),
    ).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('converts Anthropic images and cache points to native content blocks', () => {
    expect(
      buildAnthropicWireMessages(
        [
          {
            role: 'user',
            content: 'look',
            cachePoint: true,
            multimodals: [{ type: 'image', base64: 'data:image/webp;base64,BBBB' }],
          },
        ],
        { oneHourCache: true },
      ),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'BBBB' } },
          { type: 'text', text: 'look', cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
      },
    ])
  })

  it('pins natural Anthropic attachment order and the final-part cache point', () => {
    // Accepted divergence from baseline anthropic.ts:147: the old unshift()
    // path reversed attachments and cached content[0]. Preserve A, B, text
    // order and place the cache boundary on the final part instead.
    expect(
      buildAnthropicWireMessages([
        {
          role: 'user',
          content: 'compare the first and second images',
          cachePoint: true,
          multimodals: [
            { type: 'image', base64: 'data:image/png;base64,IMAGE_A' },
            { type: 'image', base64: 'data:image/jpeg;base64,IMAGE_B' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMAGE_A' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'IMAGE_B' } },
          {
            type: 'text',
            text: 'compare the first and second images',
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ])
  })

  it('converts Gemini image/audio/video rows to inlineData parts', () => {
    expect(
      reformatForGemini([
        {
          role: 'user',
          content: 'inspect',
          multimodals: [
            { type: 'image', base64: 'data:image/png;base64,AA' },
            { type: 'audio', base64: 'data:audio/ogg;base64,BB' },
            { type: 'video', base64: 'data:video/mp4;base64,CC' },
          ],
        },
      ]),
    ).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'inspect' },
            { inlineData: { mimeType: 'image/png', data: 'AA' } },
            { inlineData: { mimeType: 'audio/ogg', data: 'BB' } },
            { inlineData: { mimeType: 'video/mp4', data: 'CC' } },
          ],
        },
      ],
    })
  })

  it('converts Responses image/file inputs and omits the NewChat marker', () => {
    expect(
      buildResponseInput([
        { role: 'system', content: '[Start a new chat]', memo: 'NewChat' },
        {
          role: 'user',
          content: 'inspect',
          multimodals: [
            { type: 'image', base64: 'data:image/png;base64,AA' },
            { type: 'audio', base64: 'data:audio/wav;base64,BB' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'inspect' },
          { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,AA' },
          { type: 'input_file', file_data: 'data:audio/wav;base64,BB' },
        ],
      },
    ])
  })
})
