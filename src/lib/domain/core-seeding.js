import { supabase } from '../supabase-client.js'

export async function seedDefaultFormFields() {
  const { error } = await supabase.rpc('seed_default_form_fields')

  if (error) {
    console.error(error)
    throw error
  }
}

export async function seedDefaultClubRolesForClub() {
  const { error } = await supabase.rpc('seed_default_club_roles')

  if (error) {
    console.error(error)
    throw error
  }
}
