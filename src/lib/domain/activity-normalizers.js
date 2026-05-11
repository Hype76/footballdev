export function normalizeCommunicationLogRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    evaluationId: row.evaluation_id ?? row.evaluationId ?? '',
    userId: row.user_id ?? row.userId ?? '',
    userName: String(row.user_name ?? row.userName ?? '').trim(),
    userEmail: String(row.user_email ?? row.userEmail ?? '').trim(),
    channel: String(row.channel ?? 'activity').trim() || 'activity',
    action: String(row.action ?? '').trim(),
    recipientEmail: String(row.recipient_email ?? row.recipientEmail ?? '').trim(),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

export function normalizePlayerStaffNoteRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    sessionId: row.session_id ?? row.sessionId ?? '',
    userId: row.user_id ?? row.userId ?? '',
    userName: String(row.user_name ?? row.userName ?? '').trim(),
    userEmail: String(row.user_email ?? row.userEmail ?? '').trim(),
    note: String(row.note ?? '').trim(),
    audioPath: String(row.audio_path ?? row.audioPath ?? '').trim(),
    audioMimeType: String(row.audio_mime_type ?? row.audioMimeType ?? '').trim(),
    audioDurationSeconds: row.audio_duration_seconds ?? row.audioDurationSeconds ?? null,
    audioExpiresAt: row.audio_expires_at ?? row.audioExpiresAt ?? '',
    audioUrl: String(row.audioUrl ?? row.audio_url ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}
