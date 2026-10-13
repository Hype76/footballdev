import { createTeamLeagueStorage } from './teamLeagueStorageCore'

// Browser storage is already isolated by the website origin. Metro selects the
// native adapter for installed apps without pulling native modules into Vite.
const storage = {
  getItem: key => globalThis.localStorage?.getItem(key),
  setItem: (key, value) => globalThis.localStorage?.setItem(key, value),
  removeItem: key => globalThis.localStorage?.removeItem(key),
}
export const mobileTeamLeagueStorage = createTeamLeagueStorage(storage, 'fp.league.v1:web:')
