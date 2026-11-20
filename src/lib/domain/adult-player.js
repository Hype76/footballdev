import { supabase } from '../supabase-client.js'
import * as adultPlayerInvitations from '../adult-player-invitations.js'

export { normalizeAdultPlayerInvitation } from '../adult-player-invitations.js'

export function getOwnAdultPlayerInvitations() {
  return adultPlayerInvitations.getOwnAdultPlayerInvitations(supabase)
}

export function respondToOwnAdultPlayerInvitation(response) {
  return adultPlayerInvitations.respondToOwnAdultPlayerInvitation(supabase, response)
}
