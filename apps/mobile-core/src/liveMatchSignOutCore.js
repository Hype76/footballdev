export async function revokeSavedLiveMatchFollows({ keys, read, revoke, finish, remove }) {
  for (const key of keys) {
    const saved = await read(key)
    if (!saved?.followId) continue
    const { error } = await revoke(saved.followId)
    if (error) throw error
  }
  await finish(keys)
  if (keys.length) await remove(keys)
}

export async function reconcileSavedLiveMatchFollow(saved, { check, clear }) {
  if (!saved?.followId) return null
  let active
  try { active = await check(saved.followId) } catch { return saved }
  if (active !== false) return saved
  await clear(saved)
  return null
}

export function createLiveMatchStartBarrier() {
  const pending = new Map()
  const signingOut = new Set()
  const generations = new Map()
  return {
    generation(role) { return generations.get(role) || 0 },
    check(role, generation) {
      if (signingOut.has(role) || this.generation(role) !== generation) {
        throw new Error('Live match following stopped because you signed out.')
      }
    },
    start(role, matchId, start) {
      if (signingOut.has(role)) return Promise.reject(new Error('Sign-out is in progress. Try again after signing in.'))
      const key = `${role}:${matchId}`
      if (pending.has(key)) return pending.get(key)
      const attempt = Promise.resolve().then(start)
      pending.set(key, attempt)
      void attempt.finally(() => {
        if (pending.get(key) === attempt) pending.delete(key)
      }).catch(() => {})
      return attempt
    },
    async beforeSignOut(role) {
      signingOut.add(role)
      generations.set(role, this.generation(role) + 1)
      await Promise.allSettled([...pending.entries()].filter(([key]) => key.startsWith(`${role}:`)).map(([, attempt]) => attempt))
    },
    allow(role) { signingOut.delete(role) },
  }
}
