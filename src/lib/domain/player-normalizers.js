import { EVALUATION_SECTIONS } from '../supabase-client.js'
import {
  normalizeParentContacts,
  normalizePlayerContactType,
} from './contact-utils.js'
import {
  getEntryIdentity,
  getEntryUserId,
  normalizeWords,
} from './core-normalizers.js'
import { ARCHIVED_PLAYER_RETENTION_MONTHS, addMonths } from '../retention.js'

function getArchivedDeleteAt(row) {
  const explicitDate = row.archived_delete_at ?? row.archivedDeleteAt ?? ''

  if (explicitDate) {
    return explicitDate
  }

  const archivedAt = row.archived_at ?? row.archivedAt ?? ''

  if (!archivedAt) {
    return ''
  }

  const archivedDate = new Date(archivedAt)

  if (Number.isNaN(archivedDate.getTime())) {
    return ''
  }

  return addMonths(archivedDate, ARCHIVED_PLAYER_RETENTION_MONTHS).toISOString()
}

export function normalizePlayerRow(row) {
  const positions = Array.isArray(row.positions)
    ? row.positions.map((position) => String(position ?? '').trim()).filter(Boolean)
    : []
  const parentContacts = normalizeParentContacts(row.parent_contacts, {
    parentName: row.parent_name ?? row.parentName,
    parentEmail: row.parent_email ?? row.parentEmail,
  })

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    playerName: String(row.player_name ?? row.playerName ?? '').trim(),
    shirtNumber: String(row.shirt_number ?? row.shirtNumber ?? '').trim(),
    section: String(row.section ?? 'Trial').trim() || 'Trial',
    team: String(row.team ?? '').trim(),
    positions,
    contactType: normalizePlayerContactType(row.contact_type ?? row.contactType ?? (row.is_adult || row.isAdult ? 'self' : 'parent')),
    parentName: parentContacts[0]?.name ?? '',
    parentEmail: parentContacts[0]?.email ?? '',
    parentContacts,
    notes: String(row.notes ?? '').trim(),
    status: String(row.status ?? 'active').trim() || 'active',
    archivedReason: String(row.archived_reason ?? row.archivedReason ?? '').trim(),
    archivedAt: row.archived_at ?? row.archivedAt ?? '',
    archivedDeleteAt: getArchivedDeleteAt(row),
    archivedBy: row.archived_by ?? row.archivedBy ?? '',
    archivedPreviousStatus: String(row.archived_previous_status ?? row.archivedPreviousStatus ?? '').trim(),
    promotedAt: row.promoted_at ?? row.promotedAt ?? '',
    promotedBy: row.promoted_by ?? row.promotedBy ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

export function mapPlayerToRow(player, user) {
  const positions = Array.isArray(player.positions)
    ? player.positions.map((position) => String(position ?? '').trim()).filter(Boolean)
    : []
  const parentContacts = normalizeParentContacts(player.parentContacts, {
    parentName: player.parentName,
    parentEmail: player.parentEmail,
  })
  const primaryParent = parentContacts[0] ?? { name: '', email: '' }

  return {
    club_id: player.clubId ?? user?.clubId ?? '',
    team_id: player.teamId || user?.activeTeamId || null,
    player_name: normalizeWords(player.playerName),
    shirt_number: String(player.shirtNumber ?? player.shirt_number ?? '').trim(),
    section: EVALUATION_SECTIONS.includes(player.section) ? player.section : 'Trial',
    team: String(player.team ?? '').trim(),
    positions,
    contact_type: normalizePlayerContactType(player.contactType ?? player.contact_type ?? (player.isAdult || player.is_adult ? 'self' : 'parent')),
    parent_name: primaryParent.name,
    parent_email: primaryParent.email,
    parent_contacts: parentContacts,
    notes: String(player.notes ?? '').trim(),
    updated_by: getEntryUserId(user),
    ...getEntryIdentity(user, 'updated_by'),
  }
}
