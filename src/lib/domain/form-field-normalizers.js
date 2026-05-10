import {
  getEntryIdentity,
  getEntryUserId,
  normalizeFieldOptions,
  normalizeFieldType,
} from './core-normalizers.js'

export function normalizeFormFieldRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    label: String(row.label ?? '').trim(),
    type: normalizeFieldType(row.type),
    options: normalizeFieldOptions(row.options),
    required: Boolean(row.required),
    orderIndex: Number(row.order_index ?? row.orderIndex ?? 0),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    isEnabled: Boolean(row.is_enabled ?? row.isEnabled ?? true),
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
