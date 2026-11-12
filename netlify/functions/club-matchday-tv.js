import { getAuthenticatedPlanProfile, assertPlanFeature } from './lib/_plan-gate.js'
import { supabaseAdmin, createPublicSupabaseClient } from './lib/_supabase.js'
import { isClubWorkspace } from '../../src/lib/workspace-scope.js'
import { clubTvSlugStatus, normalizeClubTvSlug, normalizeTvPreferences, toClubTvMatch, validTvDate, validTvSponsorSchedule, tvDateAfter, tvPeriodWindow } from '../../src/lib/club-matchday-tv.js'
import { getClubTvWeather, normaliseWeatherPostcode } from './lib/_club-tv-weather.js'

export const CLUB_TV_MATCH_SELECT = 'id,club_id,team_id,opponent,match_date,kickoff_time,kickoff_time_tbc,home_away,venue_name,status,home_score,away_score,home_shootout_score,away_shootout_score,shootout_winner,timer_status,timer_elapsed_seconds,timer_started_at,concluded_at,deleted_at,teams:team_id(id,club_id,name),match_day_events(id,event_type,team_side,minute,stoppage_minute,scorer_shirt_number,event_status,match_phase,created_at)'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reply = (statusCode, payload) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(payload) })
const settingsActions = new Set(['settings', 'availability', 'save', 'view'])
const maxSettingsRequest = 5200000

export function assertClubTvAuthority(profile, clubId) {
  if (!profile || profile.role !== 'admin' || profile.clubId !== clubId
    || !isClubWorkspace(profile) || profile.accountStatus !== 'active' || profile.clubStatus !== 'active'
    || profile.clubArchivedAt || profile.testerAccessExpired) {
    throw Object.assign(new Error('Only the active Club Admin can open their own club matchday display.'), { statusCode: 403 })
  }
}

async function readTvSettings(client, clubId) {
  const { data, error } = await client.from('club_matchday_tv_settings')
    .select('slug,preferences,revision').eq('club_id', clubId).maybeSingle()
  if (error) throw error
  return data ?? { slug: null, preferences: null, revision: 0 }
}

async function handleTvSettings(client, profile, body) {
  const club = { id: profile.clubId }
  const slug = normalizeClubTvSlug(body.slug)
  const status = clubTvSlugStatus(slug)
  if (body.action === 'view') {
    if (status !== 'valid') return reply(403, { message: 'This link is unavailable for your Club Admin account.' })
    const { data, error } = await client.from('club_matchday_tv_links')
      .select('slug').eq('club_id', club.id).eq('slug', slug).maybeSingle()
    if (error) throw error
    if (!data) return reply(403, { message: 'This link is unavailable for your Club Admin account.' })
  }
  if (body.action === 'settings' || body.action === 'view') {
    return reply(200, { club, settings: await readTvSettings(client, club.id) })
  }
  if (body.action === 'availability') {
    if (status !== 'valid') return reply(200, { club, availability: status })
    const { data, error } = await client.from('club_matchday_tv_links').select('club_id').eq('slug', slug).maybeSingle()
    if (error) throw error
    return reply(200, { club, availability: data && data.club_id !== club.id ? 'taken' : 'available' })
  }
  if (body.slug != null && (typeof body.slug !== 'string' || status !== 'valid')) {
    return reply(400, { availability: status, message: status === 'reserved' ? 'This link ending is reserved.' : 'Use at least four letters. Numbers and single hyphens are also allowed.' })
  }
  if (!body.preferences || typeof body.preferences !== 'object' || Array.isArray(body.preferences)
    || !Number.isInteger(body.revision) || body.revision < 0 || body.revision >= 2147483647) {
    return reply(400, { message: 'Invalid display settings.' })
  }
  const preferences = normalizeTvPreferences(body.preferences)
  if (!preferences.sponsorAds.every(validTvSponsorSchedule)) {
    return reply(400, { message: 'Each advert end date must be on or after its start date.' })
  }
  if (preferences.weatherPostcode) {
    try { normaliseWeatherPostcode(preferences.weatherPostcode) }
    catch { return reply(400, { message: 'Enter a Great Britain ground postcode.' }) }
  }
  const { data: revision, error } = await client.rpc('save_club_matchday_tv_settings', {
    p_club_id: club.id, p_slug: slug || null, p_preferences: preferences, p_revision: body.revision,
  })
  if (error?.code === '23505') return reply(409, { availability: 'taken', message: 'This link ending is already taken.' })
  if (error?.code === 'PT409') return reply(409, { message: 'Someone saved display settings since you opened this page. Reload before saving again.' })
  if (error) throw error
  return reply(200, { club, settings: { preferences, revision } })
}

export function createClubMatchdayTvHandler({ authenticate = getAuthenticatedPlanProfile, assertFeature = assertPlanFeature, client = supabaseAdmin, weather = getClubTvWeather, passwordClient = createPublicSupabaseClient, logger = console } = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return reply(405, { message: 'Method not allowed.' })
    let action
    try {
      if (typeof event.body !== 'string' || event.body.length > maxSettingsRequest) return reply(400, { message: 'Invalid display request.' })
      let body
      try { body = JSON.parse(event.body) } catch { return reply(400, { message: 'Invalid display request.' }) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { message: 'Invalid display request.' })
      action = body.action
      const clubId = String(body?.clubId ?? '').trim(), date = body?.date, period = body.period === undefined ? 'day' : body.period
      if (body.action !== 'save' && event.body.length > 2048) return reply(400, { message: 'Invalid display request.' })
      if ((body.action !== 'view' && !uuid.test(clubId))
        || (!body.action && (!validTvDate(date) || !tvPeriodWindow(date, period)))
        || (body.action && !['weather', 'unlock'].includes(body.action) && !settingsActions.has(body.action))) return reply(400, { message: 'Choose a valid club and match date.' })
      const profile = await authenticate(event, { clubId: body.action === 'view' ? '' : clubId })
      assertClubTvAuthority(profile, body.action === 'view' ? profile?.clubId : clubId)
      // This is club-wide read access, independent of team-scoped scoring rights.
      await assertFeature(profile, 'clubAdministration')
      if (settingsActions.has(body.action)) return await handleTvSettings(client, profile, body)
      if (body.action === 'unlock') {
        if (typeof body.password !== 'string' || !body.password || body.password.length > 1024) return reply(400, { message: 'Enter your Club Admin password.' })
        const verifier = passwordClient(event)
        try {
          const { data, error } = await verifier.auth.signInWithPassword({ email: profile.authEmail, password: body.password })
          body.password = ''
          if (error || data?.user?.id !== profile.authUserId || !data?.session) return reply(401, { message: 'Password not accepted. The display stays locked.' })
          return reply(200, { club: { id: profile.clubId }, unlocked: true })
        } finally {
          body.password = ''
          // Revoke only this temporary verification session, never the TV session.
          await verifier.auth.signOut({ scope: 'local' }).catch(() => {})
        }
      }
      if (body.action === 'weather') {
        let postcode
        try { postcode = normaliseWeatherPostcode(body.postcode) } catch { return reply(400, { message: 'Enter a Great Britain ground postcode.' }) }
        return reply(200, { club: { id: profile.clubId }, weather: await weather(postcode) })
      }
      const { data: club, error: clubError } = await client.from('clubs').select('id,name,logo_url,theme_accent').eq('id', profile.clubId).single()
      if (clubError || !club || club.id !== profile.clubId) throw new Error('Club details unavailable')
      async function readMatches(startDate, endDate) {
        const matches = []
        // Stable pagination avoids the default Data API row cap dropping fixtures silently.
        for (let offset = 0; offset < 5000; offset += 250) {
          let query = client.from('match_days').select(CLUB_TV_MATCH_SELECT).eq('club_id', profile.clubId)
          query = startDate === endDate ? query.eq('match_date', startDate) : query.gte('match_date', startDate).lte('match_date', endDate)
          const { data, error } = await query.is('deleted_at', null).order('match_date', { ascending: true })
            .order('kickoff_time', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).range(offset, offset + 249)
          if (error) throw error
          for (const row of data ?? []) { const match = toClubTvMatch(row, profile.clubId); if (match) matches.push(match) }
          if ((data ?? []).length < 250) return matches
        }
        throw new Error('Display match limit exceeded')
      }
      let window = tvPeriodWindow(date, period)
      let matches = await readMatches(window.startDate, window.endDate)
      const nextDate = tvDateAfter(date, 1), endDate = tvDateAfter(date, 7)
      if (period === 'day' && !matches.length && nextDate && endDate) {
        matches = await readMatches(nextDate, endDate)
        window = { kind: 'week', startDate: nextDate, endDate }
      }
      return reply(200, { club: { id: club.id, name: club.name, logoUrl: club.logo_url || '', accent: club.theme_accent || 'green' }, date, window, matches, refreshedAt: new Date().toISOString() })
    } catch (error) {
      const status = [401, 403].includes(error?.statusCode) ? error.statusCode : 503
      logger.error('Club matchday TV request failed', { statusCode: status, code: error?.code || 'unavailable' })
      const message = status === 403 ? 'Access is restricted to your own active Club Admin workspace.'
        : status === 401 ? 'Sign in to open the club matchday display.'
          : settingsActions.has(action) ? 'Display settings are temporarily unavailable. Please try again.'
            : 'Scores could not be refreshed. Please try again.'
      return reply(status, { message })
    }
  }
}

export const handler = createClubMatchdayTvHandler()
