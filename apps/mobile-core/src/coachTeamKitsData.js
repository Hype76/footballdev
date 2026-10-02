import { CAPABILITIES } from '../../../src/lib/paywall-access.js'
import { isClubManagedTeamKit, normalizeKitColour, normalizeTeamKits } from '../../../src/lib/team-kits.js'
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
  if (isClubManagedTeamKit(user)) throw new Error('Managed by your Club Admin')
  const homeValue = String(values?.home?.colour ?? '').trim()
  const awayValue = String(values?.away?.colour ?? '').trim()
  const home = normalizeKitColour(homeValue)
  const away = normalizeKitColour(awayValue)
  if ((homeValue && !home) || (awayValue && !away)) throw new Error('Enter six-digit colours such as #1d4ed8, or leave blank to use the club kit.')
  const { data, error } = await supabase.from('teams')
    .update({ home_kit_colour: home, away_kit_colour: away })
    .eq('club_id', user.clubId)
    .eq('id', user.activeTeamId)
    .select('home_kit_colour,away_kit_colour')
    .single()
  if (error) throw error
  return normalizeTeamKits(data)
}
