import { STAFF_VOICE_NOTES_BUCKET } from '../../src/lib/domain/core-constants.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { json } from './lib/_stripe-billing.js'

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

async function getAuthenticatedUser(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw new Error('Login is required.')
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw new Error('Login is required.')
  }

  const profile = await loadActiveAuthorityProfile(supabaseAdmin, authData.user, {
    select: 'id, email, name, role, role_rank, club_id, status',
  })

  if (!profile?.club_id || Number(profile.role_rank ?? 0) < 20) {
    throw new Error('You do not have access to delete voice notes.')
  }

  return profile
}

export async function handler(event) {
  if (event.httpMethod !== 'DELETE') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  try {
    const user = await getAuthenticatedUser(event)
    const body = JSON.parse(event.body || '{}')
    const noteId = String(body.noteId ?? '').trim()

    if (!noteId) {
      return json(400, { success: false, message: 'Voice note ID is required.' })
    }

    const { data: note, error: noteError } = await supabaseAdmin
      .from('player_staff_notes')
      .select('id, club_id, player_id, session_id, user_id, note, audio_path')
      .eq('id', noteId)
      .eq('club_id', user.club_id)
      .maybeSingle()

    if (noteError) {
      throw noteError
    }

    if (!note?.id) {
      return json(404, { success: false, message: 'Voice note was not found.' })
    }

    if (String(note.user_id ?? '') !== String(user.id) && Number(user.role_rank ?? 0) < 50) {
      return json(403, { success: false, message: 'Only the note owner or a manager can delete this voice note.' })
    }

    const { error: deleteError } = await supabaseAdmin
      .from('player_staff_notes')
      .delete()
      .eq('id', note.id)
      .eq('club_id', user.club_id)

    if (deleteError) {
      throw deleteError
    }

    if (note.audio_path) {
      const { error: storageError } = await supabaseAdmin.storage
        .from(STAFF_VOICE_NOTES_BUCKET)
        .remove([note.audio_path])

      if (storageError) {
        console.error('Voice note audio file could not be deleted', storageError)
      }
    }

    await supabaseAdmin.from('communication_logs').insert({
      club_id: user.club_id,
      player_id: note.player_id || null,
      user_id: user.id,
      user_name: user.name || '',
      user_email: user.email || '',
      channel: 'voice_note',
      action: 'voice_note_deleted',
      metadata: {
        sessionId: note.session_id || '',
        noteId: note.id,
      },
    })

    return json(200, { success: true, noteId: note.id })
  } catch (error) {
    console.error(error)
    return json(error.message === 'Login is required.' ? 401 : 400, {
      success: false,
      message: error.message || 'Voice note could not be deleted.',
    })
  }
}
