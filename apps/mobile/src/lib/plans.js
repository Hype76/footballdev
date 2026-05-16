export function isPlanAccessActive(user) {
  if (user?.role === 'super_admin' || user?.isPlanComped) {
    return true
  }

  const status = String(user?.planStatus ?? '').trim()
  return status === 'active' || status === 'trialing'
}
