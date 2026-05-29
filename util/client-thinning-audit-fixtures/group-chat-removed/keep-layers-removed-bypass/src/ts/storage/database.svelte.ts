// A4R-group-chat-removed fixture (bypass): the load-time group filter was silently
// dropped during a refactor — group characters could now load into client state.
interface Database {
  characters: ({ type?: string } | null)[]
}

export function setDatabase(data: Database) {
  data.characters = data.characters.filter((c) => c !== null)
}
