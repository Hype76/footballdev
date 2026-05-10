import { supabase } from '../supabase-client.js'
import { getCachedResource } from './cache-store.js'
import { CLUB_SELECT } from './core-constants.js'

export async function fetchClubDetails(clubId) {
  if (!clubId) {
    return null
  }

  return getCachedResource(`club:${clubId}`, async () => {
    const { data, error } = await supabase
      .from('clubs')
      .select(CLUB_SELECT)
      .eq('id', clubId)
      .maybeSingle()

    if (error) {
      console.error(error)
      throw error
    }

    return data
  })
}
