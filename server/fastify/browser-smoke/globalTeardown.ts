import { mergePhase7ArtifactOutputs } from './phase7IntegrationArtifact.js'

export default function globalTeardown(): void {
  mergePhase7ArtifactOutputs({ required: process.env.RISU_PHASE7_ARTIFACT_REQUIRED === 'true' })
}
