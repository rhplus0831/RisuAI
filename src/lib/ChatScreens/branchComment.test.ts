import { describe, expect, it } from 'vitest'
import { createBranchComment, parseBranchComment } from './branchComment'

describe('branch comment metadata', () => {
  it('round-trips structured metadata without exposing delimiter-sensitive fields', () => {
    const reference = {
      sourceChatId: 'source::chat',
      sourceChatName: 'Opening::分岐::{{specialcomment}}',
      sourceMessageId: 'source::message',
    }

    const marker = createBranchComment(reference)

    expect(marker).toMatch(/^\{\{specialcomment::branchedfrom::json-v1::/)
    expect(marker).not.toContain(reference.sourceChatName)
    expect(parseBranchComment(marker)).toEqual(reference)
  })

  it('parses legacy markers whose chat names contain delimiter text', () => {
    expect(
      parseBranchComment('{{specialcomment::branchedfrom::source-chat::Opening::Alternate Ending::source-message::}}'),
    ).toEqual({
      sourceChatId: 'source-chat',
      sourceChatName: 'Opening::Alternate Ending',
      sourceMessageId: 'source-message',
    })
  })

  it('rejects unrelated and malformed markers', () => {
    expect(parseBranchComment('{{specialcomment::other::value::}}')).toBeNull()
    expect(parseBranchComment('{{specialcomment::branchedfrom::json-v1::not-json::}}')).toBeNull()
    expect(parseBranchComment('{{specialcomment::branchedfrom::missing-fields::}}')).toBeNull()
  })
})
