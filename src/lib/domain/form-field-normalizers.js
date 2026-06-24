import {
  getEntryIdentity,
  getEntryUserId,
  normalizeFieldOptions,
  normalizeFieldType,
} from './core-normalizers.js'

export function isProgressionChartScoreFieldType(type) {
  return ['score_1_5', 'score_1_10'].includes(normalizeFieldType(type))
}

export function getDefaultProgressionChartSetting(field = {}) {
  return Boolean(field.isDefault ?? field.is_default) && isProgressionChartScoreFieldType(field.type)
}

export function normalizeFormFieldRow(row) {
  const normalizedType = normalizeFieldType(row.type)
  const hasProgressionChartSetting = row.include_in_progress_chart !== undefined || row.includeInProgressChart !== undefined

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    label: String(row.label ?? '').trim(),
    type: normalizedType,
    options: normalizeFieldOptions(row.options),
    required: Boolean(row.required),
    orderIndex: Number(row.order_index ?? row.orderIndex ?? 0),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    isEnabled: Boolean(row.is_enabled ?? row.isEnabled ?? true),
    includeInProgressChart: isProgressionChartScoreFieldType(normalizedType)
      ? hasProgressionChartSetting
        ? Boolean(row.include_in_progress_chart ?? row.includeInProgressChart)
        : getDefaultProgressionChartSetting(row)
      : false,
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

export function mapFormFieldToRow(field, user, orderIndex) {
  const payload = {}

  if (field.clubId !== undefined || user?.clubId) {
    payload.club_id = field.clubId ?? user?.clubId ?? ''
  }

  if (field.teamId !== undefined || user?.activeTeamId) {
    payload.team_id = field.teamId ?? user?.activeTeamId ?? null
  }

  if (field.label !== undefined) {
    payload.label = String(field.label ?? '').trim()
  }

  if (field.type !== undefined) {
    payload.type = normalizeFieldType(field.type)
  }

  if (field.options !== undefined) {
    payload.options = normalizeFieldOptions(field.options)
  }

  if (field.required !== undefined) {
    payload.required = Boolean(field.required)
  }

  if (orderIndex !== undefined) {
    payload.order_index = orderIndex
  }

  if (field.isDefault !== undefined) {
    payload.is_default = Boolean(field.isDefault)
  }

  if (field.isEnabled !== undefined) {
    payload.is_enabled = Boolean(field.isEnabled)
  }

  if (field.includeInProgressChart !== undefined) {
    payload.include_in_progress_chart = field.type === undefined
      ? Boolean(field.includeInProgressChart)
      : isProgressionChartScoreFieldType(field.type)
        ? Boolean(field.includeInProgressChart)
        : false
  } else if (field.type !== undefined && !isProgressionChartScoreFieldType(field.type)) {
    payload.include_in_progress_chart = false
  }

  if (field.createdBy !== undefined) {
    payload.created_by = field.createdBy || null
  }

  if (field.createdByName !== undefined) {
    payload.created_by_name = String(field.createdByName ?? '').trim()
  }

  if (field.createdByEmail !== undefined) {
    payload.created_by_email = String(field.createdByEmail ?? '').trim().toLowerCase()
  }

  payload.updated_by = getEntryUserId(user)
  Object.assign(payload, getEntryIdentity(user, 'updated_by'))

  return payload
}
