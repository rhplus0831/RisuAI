import { mergeFastBootstrapArtifactOutputs } from './fastBootstrapIntegrationArtifact.js'

export default function globalTeardown(): void {
  mergeFastBootstrapArtifactOutputs({ required: process.env.RISU_FAST_BOOTSTRAP_ARTIFACT_REQUIRED === 'true' })
}
