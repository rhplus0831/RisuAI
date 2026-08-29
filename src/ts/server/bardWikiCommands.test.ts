import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stage: vi.fn(),
  dispatch: vi.fn(),
  register: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  settings: vi.fn(),
  confirm: vi.fn(),
  listener: undefined as undefined | ((settlement: 'accepted' | 'discarded', details: Record<string, unknown>) => void),
  retain: false,
}))

vi.mock('./pendingMutationOutbox', () => ({
  stagePendingMutation: mocks.stage,
}))

vi.mock('./durableMutationDispatch', () => ({
  dispatchDurableMutation: mocks.dispatch,
  registerDurableMutationSettlementListener: mocks.register,
}))

vi.mock('./commands', () => ({
  createBardWikiDocumentCommand: mocks.create,
  updateBardWikiDocumentCommand: mocks.update,
  deleteBardWikiDocumentCommand: mocks.remove,
  patchBardWikiChatSettingsCommand: mocks.settings,
  confirmBardWikiAssistantCommand: mocks.confirm,
  runServerCommand: ({ command }: { command: (baseRevision: number) => Promise<unknown> }) => command(7),
}))

import { confirmBardWikiAssistant, createBardWikiDocument, updateBardWikiDocument } from './bardWikiCommands'

const handle = {
  key: 'bardwiki-document:chat-a',
  mutationId: 'mutation-a',
  sequence: 1,
  ownerWriterSessionId: 'writer-a',
  writerEpoch: 1,
  databaseLineage: 'database-a',
  ready: Promise.resolve('persisted' as const),
  phase: 'staged' as const,
}

beforeEach(() => {
  mocks.stage.mockReset().mockReturnValue(handle)
  mocks.register.mockReset().mockImplementation((_mutationId, listener) => {
    mocks.listener = listener
    return vi.fn()
  })
  mocks.retain = false
  mocks.dispatch.mockReset().mockImplementation((_handle, _intent, dispatch) =>
    dispatch({
      mutationId: 'mutation-a',
      databaseLineage: 'database-a',
      failureRollbackDisposition: () => (mocks.retain ? 'retain' : 'rollback'),
    }),
  )
  mocks.create.mockReset()
  mocks.update.mockReset()
  mocks.remove.mockReset()
  mocks.settings.mockReset()
  mocks.confirm.mockReset()
  mocks.listener = undefined
})

describe('BardWiki durable commands', () => {
  it('stages a base-revision-free create intent and reports accepted server state', async () => {
    const document = { id: 'document-a' }
    mocks.create.mockResolvedValue({
      status: 'ok',
      revision: 8,
      event: { type: 'bardwiki.document.created', revision: 8, resource: 'bardWikiDocument' },
      document,
    })
    const input = { kind: 'event' as const, title: 'Arrival', logicalPath: 'Events/Arrival', markdown: 'Hello.' }

    await expect(createBardWikiDocument('chat-a', input)).resolves.toMatchObject({
      status: 'accepted',
      result: { revision: 8, document },
    })
    expect(mocks.stage).toHaveBeenCalledWith('bardwiki-document-create:chat-a', {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/bardwiki/chats/chat-a/documents',
          body: { document: input },
        },
      ],
    })
    expect(mocks.create).toHaveBeenCalledWith({ baseRevision: 7, chatId: 'chat-a', document: input }, undefined)
  })

  it('keeps transient failures queued and exposes their later settlement', async () => {
    mocks.retain = true
    mocks.create.mockResolvedValue({ status: 'unavailable' })

    const outcome = await createBardWikiDocument('chat-a', {
      kind: 'event',
      title: 'Arrival',
      logicalPath: 'Events/Arrival',
      markdown: 'Hello.',
    })

    expect(outcome).toMatchObject({ status: 'queued', mutationId: 'mutation-a' })
    if (outcome.status !== 'queued') throw new Error('Expected a queued outcome')
    mocks.listener?.('accepted', {})
    await expect(outcome.settlement).resolves.toEqual({ status: 'accepted' })
  })

  it('classifies stale document fences as conflicts without accepting the draft', async () => {
    mocks.update.mockResolvedValue({ status: 'error', error: 'bardwiki_document_conflict' })

    await expect(
      updateBardWikiDocument(
        'chat-a',
        'document-a',
        { expectedVersion: 2, expectedContentHash: 'a'.repeat(64) },
        { markdown: 'stale' },
      ),
    ).resolves.toEqual({
      status: 'conflict',
      result: { status: 'error', error: 'bardwiki_document_conflict' },
    })
  })

  it('stages an exact-source confirmation without an enqueue-time revision', async () => {
    const source = {
      userMessageId: 'user-a',
      userContentHash: 'a'.repeat(64),
      assistantMessageId: 'assistant-a',
      assistantContentHash: 'b'.repeat(64),
    }
    mocks.confirm.mockResolvedValue({
      status: 'ok',
      revision: 8,
      event: { type: 'bardwiki.confirmation.queued', revision: 8, resource: 'bardWikiChat' },
      receipt: { id: 'receipt-a' },
      job: { id: 'job-a' },
      created: true,
    })

    await expect(confirmBardWikiAssistant('chat-a', source)).resolves.toMatchObject({
      status: 'accepted',
      result: { revision: 8, created: true },
    })
    expect(mocks.stage).toHaveBeenCalledWith(`bardwiki-confirmation:chat-a:assistant-a:${'b'.repeat(64)}`, {
      version: 1,
      requests: [{ method: 'POST', path: '/bardwiki/chats/chat-a/confirmations', body: source }],
    })
    expect(mocks.confirm).toHaveBeenCalledWith({ baseRevision: 7, chatId: 'chat-a', ...source }, undefined)
  })
})
