import { randomUUID } from 'node:crypto'

export type MessageTranslationJobStatus = 'running' | 'succeeded' | 'failed'

export interface MessageTranslationJob {
  chatId: string
  messageId: string
  jobId: string
  status: MessageTranslationJobStatus
  error?: string
  completedAt?: number
}

interface ActiveMessageTranslationEntry extends MessageTranslationJob {
  status: 'running'
  token: string
}

export interface MessageTranslationJobHandle {
  jobId: string
  succeed(): void
  fail(error: unknown): void
}

const TERMINAL_RETENTION_MS = 10 * 60_000
const MAX_TERMINAL_JOBS = 128
const MAX_ERROR_LENGTH = 500

/** Detached raw-translation jobs plus a bounded terminal reattachment history. */
export class MessageTranslationJobRegistry {
  private readonly activeByMessage = new Map<string, ActiveMessageTranslationEntry>()
  private readonly terminalByMessage = new Map<string, MessageTranslationJob>()

  register(input: Pick<MessageTranslationJob, 'chatId' | 'messageId'>): MessageTranslationJobHandle {
    const token = randomUUID()
    const jobId = randomUUID()
    this.terminalByMessage.delete(input.messageId)
    this.activeByMessage.set(input.messageId, { ...input, jobId, status: 'running', token })
    return {
      jobId,
      succeed: () => this.complete(input.messageId, token, { status: 'succeeded' }),
      fail: (error) => this.complete(input.messageId, token, { status: 'failed', error: safeTranslationError(error) }),
    }
  }

  translations(): MessageTranslationJob[] {
    this.pruneTerminalJobs()
    return [
      ...[...this.activeByMessage.values()].map(({ token: _token, ...job }) => job),
      ...this.terminalByMessage.values(),
    ]
  }

  private complete(
    messageId: string,
    token: string,
    terminal: { status: 'succeeded' } | { status: 'failed'; error: string },
  ): void {
    const active = this.activeByMessage.get(messageId)
    if (!active || active.token !== token) return
    this.activeByMessage.delete(messageId)
    this.terminalByMessage.set(messageId, {
      chatId: active.chatId,
      messageId: active.messageId,
      jobId: active.jobId,
      ...terminal,
      completedAt: Date.now(),
    })
    this.pruneTerminalJobs()
  }

  private pruneTerminalJobs(): void {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS
    for (const [messageId, job] of this.terminalByMessage) {
      if ((job.completedAt ?? 0) < cutoff) this.terminalByMessage.delete(messageId)
    }
    while (this.terminalByMessage.size > MAX_TERMINAL_JOBS) {
      const oldest = this.terminalByMessage.keys().next().value as string | undefined
      if (!oldest) break
      this.terminalByMessage.delete(oldest)
    }
  }
}

function safeTranslationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = raw
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .trim()
  return (redacted || 'Message translation failed').slice(0, MAX_ERROR_LENGTH)
}
