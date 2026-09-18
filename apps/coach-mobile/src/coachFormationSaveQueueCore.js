const RETRYABLE_MESSAGE = /failed to fetch|network request failed|networkerror|timed out|timeout|offline|connection|connect and retry/i
const NON_RETRYABLE_MESSAGE = /formation_board_version_conflict|permission|forbidden|unauthori[sz]ed|access denied|not allowed|revoked|no longer available/i

export function isRetryableFormationSaveError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0)
  if (status >= 400 && status < 500) return false
  const code = String(error?.code || '').toLowerCase()
  if (NON_RETRYABLE_MESSAGE.test(code)) return false
  const message = String(error?.message || error || '')
  if (NON_RETRYABLE_MESSAGE.test(message)) return false
  return RETRYABLE_MESSAGE.test(message) || error?.name === 'AbortError'
}

export function mergeFormationPendingSaves(previous = {}, changes) {
  const next = { ...(previous || {}) }
  if (changes === undefined) return next
  Object.entries(changes || {}).forEach(([key, value]) => {
    if (value === null) delete next[key]
    else next[key] = value
  })
  return next
}
