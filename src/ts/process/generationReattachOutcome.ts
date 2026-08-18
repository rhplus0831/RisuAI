export type GenerationReattachOutcomeStatus =
  | 'retryable_transport_failure'
  | 'authority_reconciliation_required'
  | 'observer_superseded'
  | 'terminal_failure'
  | 'missing_job'
  | 'aborted'
  | 'cancelled'
  | 'completed'

export interface GenerationReattachOutcome {
  status: GenerationReattachOutcomeStatus
  error?: string
}
