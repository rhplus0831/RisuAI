// Invariant: load-time database filtering keeps group characters out of client state.
interface Database {
  characters: ({ type?: string } | null)[]
}

export function setDatabase(data: Database) {
  data.characters = data.characters.filter((c) => (c as { type?: string } | null)?.type !== 'group')
}
