import { writable } from 'svelte/store'

export const RegexDisplayReloadPointer = writable(0)

export function reloadRegexDisplay() {
  RegexDisplayReloadPointer.update((value) => value + 1)
}
