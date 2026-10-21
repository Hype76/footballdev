// Only the display-lock flag is kept. Passwords never enter browser storage.
export const clubTvLockKey = (user) => `fp:club-tv-lock:${user?.id}:${user?.clubId}`
export function isClubTvLocked(user) {
  if (!user?.id || !user?.clubId) return false
  try { return sessionStorage.getItem(clubTvLockKey(user)) === 'locked' } catch { return false }
}
export function setClubTvLocked(user, locked) {
  if (locked) sessionStorage.setItem(clubTvLockKey(user), 'locked')
  else sessionStorage.removeItem(clubTvLockKey(user))
}
