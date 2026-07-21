import { writable } from 'svelte/store'
import type { alertData } from '../alert'

export const selectedCharID = writable(-1)
export const alertStore = writable({
  type: 'none',
  msg: 'n',
} as alertData)
