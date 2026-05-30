// Violation: load-time database filtering lets group characters enter client state.
interface Database {
  characters: ({ type?: string } | null)[]
}

export function setDatabase(data: Database) {
  data.characters = data.characters.filter((c) => c !== null)
}
