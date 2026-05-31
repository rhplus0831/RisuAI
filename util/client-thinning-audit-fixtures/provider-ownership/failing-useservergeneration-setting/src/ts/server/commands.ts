// Anti-pattern: useServerGeneration is exposed as a Fastify server settings
// command. Provider-routing ownership must not be a durable, command-writable
// setting.
export const SERVER_SETTINGS_GROUP_BY_KEY = {
  temperature: 'generation',
  maxContext: 'generation',
  useServerGeneration: 'generation',
  useServerPromptAssembly: 'runtime',
}
