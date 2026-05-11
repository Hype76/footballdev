import process from 'node:process'
import { STAFF_VOICE_NOTES_BUCKET } from '../../src/lib/domain/core-constants.js'
import { supabaseAdmin } from './_supabase.js'
import { json } from './_stripe-billing.js'

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

export async function handler() {
  try {
    if (String(process.env.RETENTION_CLEANUP_ENABLED ?? '').trim().toLowerCase() !== 'true') {
      return json(200, {
        success: true,
        skipped: true,
        message: 'Retention cleanup is disabled.',
      })
    }

    const nowIso = new Date().toISOString()
    const [voiceNotesDeleted, archivedPlayersDeleted] = await Promise.all([
      deleteExpiredVoiceNotes(nowIso),
      deleteExpiredArchivedPlayers(nowIso),
    ])

    return json(200, {
      success: true,
      voiceNotesDeleted,
      archivedPlayersDeleted,
    })
  } catch (error) {
    console.error(error)
    return json(500, {
      success: false,
      message: error.message || 'Retention cleanup failed.',
    })
  }
}
