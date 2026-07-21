function forbidden() {
  return Object.assign(new Error('Only an authorised club admin can change this club logo.'), { statusCode: 403 })
}

export function assertClubLogoActorAuthority(profile, requestedClubId) {
  if (!profile || !requestedClubId) {
    throw forbidden()
  }

  if (profile.accountStatus && profile.accountStatus !== 'active') {
    throw forbidden()
  }

  if (profile.clubStatus && profile.clubStatus !== 'active') {
    throw forbidden()
  }

  const isPlatformAdmin = profile.role === 'super_admin' && Number(profile.roleRank ?? 0) >= 100
  const isOwnClubAdmin = profile.role === 'admin'
    && Number(profile.roleRank ?? 0) >= 90
    && profile.clubId === requestedClubId

  if (!isPlatformAdmin && !isOwnClubAdmin) {
    throw forbidden()
  }

  return { isPlatformAdmin, isOwnClubAdmin }
}
