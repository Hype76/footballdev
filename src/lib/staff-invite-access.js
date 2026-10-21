export function isStaffInvitationAdmin(user) {
  if (user?.role === 'super_admin') return true
  return (user?.role === 'admin' && Number(user.roleRank ?? 0) >= 90)
    || (user?.role === 'head_manager' && Number(user.roleRank ?? 0) >= 70)
}
