export const COMPAT_SCENARIOS = ['send', 'regenerate', 'continue', 'multisend'] as const
export const COMPAT_TRANSPORTS = ['buffered', 'streamed'] as const

export type CompatScenario = (typeof COMPAT_SCENARIOS)[number]
export type CompatTransport = (typeof COMPAT_TRANSPORTS)[number]

export interface CompatCellDefinition {
  id: string
  scenario: CompatScenario
  transport: CompatTransport
  useSayNothing: boolean
}

export interface CapturedProviderRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface CompatCellArtifact extends CompatCellDefinition {
  execution: {
    completed: boolean
    providerCallCount: number
    error?: string
  }
  persistedTranscript: Array<Record<string, unknown>>
  providerRequests: CapturedProviderRequest[]
}

export interface CompatSideArtifact {
  schemaVersion: 1
  side: 'baseline' | 'current'
  baselineCommit: '71c476e9c86263fe907105b011ca4dde0a619d66'
  boundary: string
  cells: CompatCellArtifact[]
}

export interface CompatCellDiff extends CompatCellDefinition {
  divergent: boolean
  transcriptDivergent: boolean
  requestDivergent: boolean
  executionDivergent: boolean
  baseline: Pick<CompatCellArtifact, 'execution' | 'persistedTranscript' | 'providerRequests'>
  current: Pick<CompatCellArtifact, 'execution' | 'persistedTranscript' | 'providerRequests'>
}

export interface CompatDiffArtifact {
  schemaVersion: 1
  baselineCommit: CompatSideArtifact['baselineCommit']
  summary: {
    totalCells: number
    divergentCells: number
    transcriptDivergences: number
    requestDivergences: number
    executionDivergences: number
  }
  cells: CompatCellDiff[]
}

export interface Cluster10Artifact {
  schemaVersion: 1
  replayCapCanonicalTerminal: {
    healthy: boolean
    retainedEventTypes: string[]
    clientStatus: string
    clientError?: string
    canonicalTerminalResult: string
    clientDisplayedResult: string
  }
  retriedExtendContinueDuplicate: {
    healthy: boolean
    afterFirstAttempt: string
    duringRetry: string
    canonicalTerminalResult: string
    afterCanonicalTerminal: string
  }
}

export function compatCells(): CompatCellDefinition[] {
  return COMPAT_SCENARIOS.flatMap((scenario) =>
    COMPAT_TRANSPORTS.flatMap((transport) =>
      [false, true].map((useSayNothing) => ({
        id: `${scenario}__${transport}__say-${useSayNothing ? 'on' : 'off'}`,
        scenario,
        transport,
        useSayNothing,
      })),
    ),
  )
}
