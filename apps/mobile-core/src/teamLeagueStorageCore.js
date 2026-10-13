import { normalizeTeamLeagueUrl } from '../../../src/lib/team-league-link.js'

// A saved display value never carries permission to edit or open a website.
function displayValue(value, teamId) {
  if (!value || value.teamId !== teamId) return null
  try {
    return { teamId, teamName: String(value.teamName || '').slice(0, 200), url: normalizeTeamLeagueUrl(value.url), enabled: value.enabled === true, canEdit: false }
  } catch { return null }
}

export function createTeamLeagueStorage(storage, prefix, { readTimeoutMs = 1000 } = {}) {
  const queues = new Map()
  function enqueue(key, action) {
    const pending = (queues.get(key) || Promise.resolve()).catch(() => {}).then(action)
    queues.set(key, pending)
    void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key) }).catch(() => {})
    return pending
  }
  return {
    async read(key, teamId) {
      if (!key) return null
      let timer
      const lookup = (async () => {
        await queues.get(key)?.catch(() => {})
        try {
          const saved = JSON.parse(await storage.getItem(prefix + key) || 'null')
          return saved?.key === key ? displayValue(saved.value, teamId) : null
        } catch { return null }
      })()
      try { return await Promise.race([lookup, new Promise(resolve => { timer = setTimeout(() => resolve(null), readTimeoutMs) })]) }
      finally { clearTimeout(timer) }
    },
    write(key, value, isCurrent) {
      return enqueue(key, async () => {
        const safe = displayValue(value, value?.teamId)
        if (!key || !safe || !isCurrent()) return
        await storage.setItem(prefix + key, JSON.stringify({ key, value: safe }))
      }).catch(() => {})
    },
    remove(key, isCurrent) {
      return enqueue(key, async () => { if (key && isCurrent()) await storage.removeItem(prefix + key) }).catch(() => {})
    },
  }
}
