// Device appearance survives screen remounts and late storage reads.
import { normalizeDeviceThemeMode } from './deviceThemeCore.js'

export function createDeviceThemePreference({ read, write }) {
  let current = null
  let pendingWrite = Promise.resolve()
  return {
    peek: () => current || 'system',
    async read() {
      if (current !== null) return current
      const saved = await read()
      if (current === null) current = normalizeDeviceThemeMode(saved)
      return current
    },
    write(mode) {
      current = normalizeDeviceThemeMode(mode)
      const next = current
      pendingWrite = pendingWrite.catch(() => {}).then(() => write(next))
      return pendingWrite.then(() => next)
    },
    reset() { current = null },
  }
}
