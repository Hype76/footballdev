function normalizeText(value) {
  return String(value ?? '').trim()
}

export function canChooseTrainingAttendanceVisibility(user = {}) {
  return normalizeText(user.role) === 'head_manager'
    && Number(user.roleRank ?? 0) >= 70
    && Boolean(normalizeText(user.activeTeamId))
}

function assertEligibleTeamAdmin(user) {
  if (!canChooseTrainingAttendanceVisibility(user)) {
    throw new Error('Team Admin access is required to change this Training attendance setting.')
  }
}

export async function getTrainingAttendanceVisibility(client, user) {
  assertEligibleTeamAdmin(user)
  const { data, error } = await client.rpc('get_own_training_attendance_visibility', {
    team_id_value: user.activeTeamId,
  })

  if (error) throw error
  return data !== false
}

export async function setTrainingAttendanceVisibility(client, user, visible) {
  assertEligibleTeamAdmin(user)
  const { data, error } = await client.rpc('set_own_training_attendance_visibility', {
    team_id_value: user.activeTeamId,
    visible_value: visible === true,
  })

  if (error) throw error
  return data !== false
}
