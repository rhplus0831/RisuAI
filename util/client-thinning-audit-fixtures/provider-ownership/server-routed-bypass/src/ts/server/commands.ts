// EC1 fixture: useServerGeneration is not exposed as a Fastify server settings
// command (it is provider-routing ownership, not a durable setting).
export const SERVER_SETTINGS_GROUP_BY_KEY = {
  temperature: 'generation',
  maxContext: 'generation',
}
