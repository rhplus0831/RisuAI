import { writable, type Writable } from 'svelte/store'
import type { hubType } from './characterCards'

export const showRealmInfoStore: Writable<null | hubType> = writable(null)
