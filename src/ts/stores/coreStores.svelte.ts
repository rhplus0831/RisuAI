import { writable } from 'svelte/store'
import type { alertData } from '../types/alert'

export const selectedCharID = writable(-1)
export const selIdState = $state({
  selId: -1,
})
selectedCharID.subscribe((value) => {
  selIdState.selId = value
})

export const loadedStore = writable(false)
export const alertStore = writable({
  type: 'none',
  msg: 'n',
} as alertData)

export const LoadingStatusState = $state({
  text: '',
})
