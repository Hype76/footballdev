import process from 'node:process'
import { STAFF_VOICE_NOTES_BUCKET } from '../../src/lib/domain/core-constants.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { json } from './lib/_stripe-billing.js'

const DATA_TRANSFER_PRIVATE_BUCKET = 'data-transfer-private'

export const config = {
  schedule: '@daily',
}

async function deleteExpiredVoiceNotes(nowIso) {
  const { data: notes, error } = await supabaseAdmin
    .from('player_staff_notes')
    .select('id, audio_path')
    .not('audio_path', 'eq', '')
    .lte('audio_expires_at', nowIso)
    .limit(500)

  if (error) {
    throw error
  }

  const audioPaths = (notes ?? []).map((note) => String(note.audio_path ?? '').trim()).filter(Boolean)

  if (audioPaths.length > 0) {
    const { error: storageError } = await supabaseAdmin.storage
      .from(STAFF_VOICE_NOTES_BUCKET)
      .remove(audioPaths)

    if (storageError) {
      console.error('Expired voice note files could not all be deleted', storageError)
    }
  }

  const noteIds = (notes ?? []).map((note) => note.id).filter(Boolean)

  if (noteIds.length === 0) {
    return 0
  }

  const { error: deleteError } = await supabaseAdmin
    .from('player_staff_notes')
    .delete()
    .in('id', noteIds)

  if (deleteError) {
    throw deleteError
  }

  return noteIds.length
}

async function deleteExpiredArchivedPlayers(nowIso) {
  const { data: players, error } = await supabaseAdmin
    .from('players')
    .select('id, club_id, player_name')
    .eq('status', 'archived')
    .lte('archived_delete_at', nowIso)
    .limit(250)

  if (error) {
    throw error
  }

  if (!players?.length) {
    return 0
  }

  const expiredPlayerIds = players.map((player) => player.id).filter(Boolean)
  const { data: playerVoiceNotes, error: playerVoiceNotesError } = await supabaseAdmin
    .from('player_staff_notes')
    .select('audio_path')
    .in('player_id', expiredPlayerIds)

  if (playerVoiceNotesError) {
    throw playerVoiceNotesError
  }

  const playerAudioPaths = (playerVoiceNotes ?? [])
    .map((note) => String(note.audio_path ?? '').trim())
    .filter(Boolean)

  if (playerAudioPaths.length > 0) {
    const { error: storageError } = await supabaseAdmin.storage
      .from(STAFF_VOICE_NOTES_BUCKET)
      .remove(playerAudioPaths)

    if (storageError) {
      console.error('Archived player voice files could not all be deleted', storageError)
    }
  }

  for (const player of players) {
    const playerId = String(player.id ?? '').trim()
    const clubId = String(player.club_id ?? '').trim()
    const playerName = String(player.player_name ?? '').trim()

    if (!playerId || !clubId) {
      continue
    }

    const { data: sessions, error: sessionError } = await supabaseAdmin
      .from('assessment_sessions')
      .select('id')
      .eq('club_id', clubId)

    if (sessionError) {
      throw sessionError
    }

    const sessionIds = (sessions ?? []).map((session) => session.id).filter(Boolean)

    const { error: evaluationIdError } = await supabaseAdmin
      .from('evaluations')
      .delete()
      .eq('club_id', clubId)
      .eq('player_id', playerId)

    if (evaluationIdError) {
      throw evaluationIdError
    }

    if (playerName) {
      const { error: evaluationNameError } = await supabaseAdmin
        .from('evaluations')
        .delete()
        .eq('club_id', clubId)
        .eq('player_name', playerName)

      if (evaluationNameError) {
        throw evaluationNameError
      }
    }

    const { error: sessionPlayerIdError } = await supabaseAdmin
      .from('assessment_session_players')
      .delete()
      .eq('player_id', playerId)

    if (sessionPlayerIdError) {
      throw sessionPlayerIdError
    }

    if (sessionIds.length > 0 && playerName) {
      const { error: sessionPlayerNameError } = await supabaseAdmin
        .from('assessment_session_players')
        .delete()
        .in('session_id', sessionIds)
        .eq('player_name', playerName)

      if (sessionPlayerNameError) {
        throw sessionPlayerNameError
      }
    }
  }

  const { error: playerDeleteError } = await supabaseAdmin
    .from('players')
    .delete()
    .eq('status', 'archived')
    .in('id', expiredPlayerIds)

  if (playerDeleteError) {
    throw playerDeleteError
  }

  return expiredPlayerIds.length
}

async function deleteExpiredDataTransferFiles(nowIso) {
  const { data: batches, error } = await supabaseAdmin
    .from('data_transfer_batches')
    .select('id, state, storage_path')
    .not('storage_path', 'is', null)
    .lte('raw_expires_at', nowIso)
    .limit(500)

  if (error?.code === '42P01') {
    return 0
  }

  if (error) {
    throw error
  }

  const paths = (batches ?? []).map((batch) => String(batch.storage_path ?? '').trim()).filter(Boolean)
  if (paths.length > 0) {
    const { error: storageError } = await supabaseAdmin.storage.from(DATA_TRANSFER_PRIVATE_BUCKET).remove(paths)
    if (storageError) {
      throw storageError
    }
  }

  for (const batch of batches ?? []) {
    const nextState = ['uploaded', 'inspecting', 'invalid', 'ready_for_review', 'awaiting_confirmation'].includes(batch.state)
      ? 'expired'
      : batch.state
    const { error: updateError } = await supabaseAdmin
      .from('data_transfer_batches')
      .update({ storage_path: null, state: nextState, updated_at: nowIso })
      .eq('id', batch.id)
      .eq('storage_path', batch.storage_path)

    if (updateError) {
      throw updateError
    }
  }

  return paths.length
}

export async function handler() {
  try {
    const existingRetentionEnabled = String(process.env.RETENTION_CLEANUP_ENABLED ?? '').trim().toLowerCase() === 'true'
    const nowIso = new Date().toISOString()
    const [voiceNotesDeleted, archivedPlayersDeleted, dataTransferFilesDeleted] = await Promise.all([
      existingRetentionEnabled ? deleteExpiredVoiceNotes(nowIso) : 0,
      existingRetentionEnabled ? deleteExpiredArchivedPlayers(nowIso) : 0,
      deleteExpiredDataTransferFiles(nowIso),
    ])

    return json(200, {
      success: true,
      skipped: !existingRetentionEnabled,
      existingRetentionEnabled,
      voiceNotesDeleted,
      archivedPlayersDeleted,
      dataTransferFilesDeleted,
    })
  } catch (error) {
    console.error(error)
    return json(500, {
      success: false,
      message: error.message || 'Retention cleanup failed.',
    })
  }
}
