import { CAPABILITIES } from '../../../src/lib/paywall-access.js'
import { normalizeKitColour, normalizeTeamKits } from '../../../src/lib/team-kits.js'
import { assertCoachCapability, assertCoachOperationalMutation, assertCoachOperationalRead } from './coachOperationalData'
import { supabase } from './supabase'

export async function getCoachTeamKits(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const { data, error } = await supabase.from('teams')
    .select('home_kit_colour,away_kit_colour')
    .eq('club_id', user.clubId)
    .eq('id', user.activeTeamId)
    .single()
  if (error) throw error
  return normalizeTeamKits(data)
}

export async function saveCoachTeamKits(user, values) {
  assertCoachOperationalMutation(user, { minimumRank: 50, requiresTeam: true })
  assertCoachCapability(user, CAPABILITIES.matchDay)
  const home = normalizeKitColour(values?.home?.colour)
  const away = normalizeKitColour(values?.away?.colour)
  if (!home || !away) throw new Error('Enter six-digit colours such as #1d4ed8.')
  const { data, error } = await supabase.from('teams')
    .update({ home_kit_colour: home, away_kit_colour: away })
    .eq('club_id', user.clubId)
    .eq('id', user.activeTeamId)
    .select('home_kit_colour,away_kit_colour')
    .single()
  if (error) throw error
  return normalizeTeamKits(data)
}
