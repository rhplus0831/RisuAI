export const PERSONA_SELECTION_MUTATION_KEY = 'persona:selection'

export function personaOwnerMutationKey(personaId: string): string {
  return `persona-profile:${personaId}`
}
