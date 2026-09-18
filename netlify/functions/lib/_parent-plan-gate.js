function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function assertParentPlanFeatureForScope({
  actionCategory = 'READ',
  clubId,
  featureName,
  parentLinkId,
  playerId,
  teamId,
} = {}, {
  loadPlanGate = () => import('./_plan-gate.js'),
} = {}) {
  const normalizedClubId = normalizeText(clubId)
  const normalizedFeatureName = normalizeText(featureName)

  if (!normalizedClubId || !normalizedFeatureName || !normalizeText(parentLinkId)) {
    throw Object.assign(new Error('Parent plan access could not be verified.'), { statusCode: 403 })
  }

  try {
    const { assertPlanFeature, getClubPlanProfile } = await loadPlanGate()
    const planProfile = await getClubPlanProfile(normalizedClubId)
    const parentPlanProfile = {
      ...planProfile,
      activeTeamId: normalizeText(teamId),
      parentLinkId: normalizeText(parentLinkId),
      playerId: normalizeText(playerId),
      role: 'parent_portal',
      roleLabel: 'Parent',
      roleRank: 0,
      teamId: normalizeText(teamId),
    }

    assertPlanFeature(parentPlanProfile, normalizedFeatureName, { actionCategory })
    return parentPlanProfile
  } catch (error) {
    if (!error.status && error.statusCode) {
      error.status = error.statusCode
    }
    throw error
  }
}
