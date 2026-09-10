// Device appearance survives screen remounts and late storage reads.
export function createCoachThemePreference({ read, write }) {
  let current = null
  let pendingWrite = Promise.resolve()
  return {
    peek: () => current || 'dark',
    async read() {
      if (current !== null) return current
      const saved = await read()
      if (current === null) current = saved === 'light' ? 'light' : 'dark'
      return current
    },
    write(mode) {
      current = mode === 'light' ? 'light' : 'dark'
      const next = current
      pendingWrite = pendingWrite.catch(() => {}).then(() => write(next))
      return pendingWrite.then(() => next)
    },
    reset() { current = null },
  }
}
