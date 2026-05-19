import { supabase } from '../supabase-client.js'
import { STAFF_VOICE_NOTES_BUCKET } from './core-constants.js'

export function getAudioFileExtension(mimeType) {
  const normalizedType = String(mimeType ?? '').toLowerCase()

  if (normalizedType.includes('mp4')) {
    return 'mp4'
  }

  if (normalizedType.includes('mpeg')) {
    return 'mp3'
  }

  if (normalizedType.includes('wav')) {
    return 'wav'
  }

  if (normalizedType.includes('ogg')) {
    return 'ogg'
  }

  return 'webm'
}

export function getBaseAudioMimeType(mimeType) {
  const normalizedType = String(mimeType ?? '').toLowerCase().split(';')[0].trim()

  if (normalizedType === 'audio/mp4') {
    return 'audio/mp4'
  }

  if (normalizedType === 'audio/mpeg') {
    return 'audio/mpeg'
  }

  if (normalizedType === 'audio/wav') {
    return 'audio/wav'
  }

  if (normalizedType === 'audio/ogg') {
    return 'audio/ogg'
  }

  return 'audio/webm'
}

export async function uploadStaffVoiceNote({ user, playerId = '', sessionId = '', audioBlob }) {
  if (!audioBlob) {
    return { audioPath: '', audioMimeType: '' }
  }

  const audioMimeType = getBaseAudioMimeType(audioBlob.type || 'audio/webm')
  const targetId = String(playerId || sessionId || 'team-note').replace(/[^a-zA-Z0-9-]/g, '')
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const audioPath = `${user.clubId}/${targetId}/${randomId}.${getAudioFileExtension(audioMimeType)}`

  const { error } = await supabase.storage.from(STAFF_VOICE_NOTES_BUCKET).upload(audioPath, audioBlob, {
    cacheControl: '3600',
    contentType: audioMimeType,
    upsert: false,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return { audioPath, audioMimeType }
}

export async function attachStaffVoiceNoteUrls(notes) {
  return Promise.all(
    notes.map(async (note) => {
      if (!note.audioPath) {
        return note
      }

      const { data, error } = await supabase.storage
        .from(STAFF_VOICE_NOTES_BUCKET)
        .createSignedUrl(note.audioPath, 60 * 60)

      if (error) {
        console.error(error)
        return note
      }

      return {
        ...note,
        audioUrl: data?.signedUrl || '',
      }
    }),
  )
}
