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
