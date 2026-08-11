export type GenerationReattachOutcomeStatus =
  | 'retryable_transport_failure'
  | 'terminal_failure'
  | 'missing_job'
  | 'aborted'
  | 'cancelled'
  | 'completed'

export interface GenerationReattachOutcome {
  status: GenerationReattachOutcomeStatus
  error?: string
}
