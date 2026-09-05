import { createSubscriber } from 'svelte/reactivity'
import { observeLanguageReads, subscribeLanguageChanges } from './index'

let installed = false

/** Live imported language reads repaint after a deferred pack is applied. */
export function installLanguageReactivity(): void {
  if (installed) return
  installed = true
  observeLanguageReads(createSubscriber(subscribeLanguageChanges))
}
