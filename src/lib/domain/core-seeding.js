import { supabase } from '../supabase-client.js'

export async function seedDefaultFormFields() {
  const { error } = await supabase.rpc('seed_default_form_fields')

  if (error) {
    console.error(error)
    throw error
  }
}

export async function seedDefaultClubRolesForClub(clubId) {
  if (!clubId) {
    return
  }

  const { error } = await supabase.rpc('seed_default_club_roles', {
    target_club_id: clubId,
  })

  if (error) {
    console.error(error)
    throw error
  }
}
