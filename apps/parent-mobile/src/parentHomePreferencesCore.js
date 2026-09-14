export const PARENT_HOME_SECTIONS = Object.freeze(['fixtures', 'calendar', 'recentMatches'])

export function normalizeParentHomeSections(value) {
  return Object.fromEntries(PARENT_HOME_SECTIONS.map(section => [section, value?.[section] !== false]))
}

export function createParentHomePreferences({ read, write }) {
  let current = null
  let writes = Promise.resolve()
  return {
    async read() {
      if (current) return current
      let saved
      try { saved = JSON.parse(await read()) } catch { saved = null }
      if (!current) current = normalizeParentHomeSections(saved)
      return current
    },
    peek: () => current || normalizeParentHomeSections(),
    toggle(section) {
      if (!PARENT_HOME_SECTIONS.includes(section)) throw new Error('Unknown Home section')
      const previous = current || normalizeParentHomeSections()
      current = { ...previous, [section]: !previous[section] }
      const next = current
      writes = writes.catch(() => {}).then(() => write(JSON.stringify(next)))
      return writes.then(() => next)
    },
  }
}
