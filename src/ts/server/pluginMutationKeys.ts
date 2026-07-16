/** Serialize every plugin record/provider/order mutation through one durable lane. */
export const PLUGIN_COLLECTION_MUTATION_KEY = 'plugin:collection'

/** Serialize plugin custom-storage mutations so bulk and per-key writes compose exactly. */
export const PLUGIN_STORAGE_MUTATION_KEY = 'plugin:storage'
