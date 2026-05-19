import { isPlanAccessActive } from './plans'
import { supabase } from './supabase'

const userProfileSelect = [
  'id',
  'email',
  'username',
  'name',
  'role',
  'role_label',
  'role_rank',
  'club_id',
  'status',
  'suspended_at',
  'display_name',
  'team_name',
  'club_name',
  'reply_to_email',
].join(', ')

const clubSelect = [
  'id',
  'name',
  'logo_url',
  'contact_email',
  'contact_phone',
  'require_approval',
  'status',
  'suspended_at',
  'plan_key',
  'plan_status',
  'is_plan_comped',
  'tester_access_expires_at',
].join(', ')

function normalizeDateExpired(value) {
  if (!value) {
    return false
  }

  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.getTime() < Date.now()
}

function getDisplayName(profile, authUser) {
  return String(
    profile?.display_name ||
      profile?.name ||
      profile?.username ||
      authUser?.user_metadata?.display_name ||
      authUser?.email?.split('@')[0] ||
      'User',
  ).trim()
}

function normalizeProfile(profile, club, authUser) {
  const testerAccessExpired = normalizeDateExpired(club?.tester_access_expires_at)
  const normalized = {
    id: profile.id,
    email: String(profile.email || authUser.email || '').trim().toLowerCase(),
    name: getDisplayName(profile, authUser),
    role: String(profile.role || '').trim(),
    roleLabel: String(profile.role_label || profile.role || 'User').trim(),
    roleRank: Number(profile.role_rank || 0),
    accountStatus: String(profile.status || 'active').trim(),
    clubId: String(profile.club_id || '').trim(),
    clubName: String(club?.name || profile.club_name || 'Football Player').trim(),
    clubLogoUrl: String(club?.logo_url || '').trim(),
    clubStatus: String(club?.status || 'active').trim(),
    planKey: String(club?.plan_key || 'small_club').trim(),
    planStatus: String(club?.plan_status || 'active').trim(),
    isPlanComped: testerAccessExpired ? false : Boolean(club?.is_plan_comped),
    testerAccessExpired,
  }

  return {
    ...normalized,
    hasActivePlanAccess: isPlanAccessActive(normalized),
  }
}

export async function fetchMobileUserProfile(authUser) {
  if (!authUser?.id) {
    throw new Error('Login again to load your profile.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(userProfileSelect)
    .eq('id', authUser.id)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile) {
    throw new Error('No access profile was found for this login.')
  }

  let club = null
  if (profile.club_id) {
    const { data: clubData, error: clubError } = await supabase
      .from('clubs')
      .select(clubSelect)
      .eq('id', profile.club_id)
      .maybeSingle()

    if (clubError) {
      throw clubError
    }

    club = clubData
  }

  return normalizeProfile(profile, club, authUser)
}
