// A4R-group-chat-removed fixture (passing): setDatabase keeps the load-time filter
// that strips group characters before they enter client state.
interface Database {
  characters: ({ type?: string } | null)[]
}

export function setDatabase(data: Database) {
  data.characters = data.characters.filter((c) => (c as { type?: string } | null)?.type !== 'group')
}
