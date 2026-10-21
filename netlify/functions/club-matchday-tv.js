import { getAuthenticatedPlanProfile, assertPlanFeature } from './lib/_plan-gate.js'
import { supabaseAdmin, createPublicSupabaseClient } from './lib/_supabase.js'
import { isClubWorkspace } from '../../src/lib/workspace-scope.js'
import { toClubTvMatch, validTvDate } from '../../src/lib/club-matchday-tv.js'
import { getClubTvWeather, normaliseWeatherPostcode } from './lib/_club-tv-weather.js'

export const CLUB_TV_MATCH_SELECT = 'id,club_id,team_id,opponent,match_date,kickoff_time,kickoff_time_tbc,home_away,venue_name,status,home_score,away_score,home_shootout_score,away_shootout_score,timer_status,timer_elapsed_seconds,timer_started_at,concluded_at,deleted_at,teams:team_id(id,club_id,name),match_day_events(id,event_type,team_side,minute,stoppage_minute,scorer_shirt_number,event_status,match_phase,created_at)'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reply = (statusCode, payload) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(payload) })

export function assertClubTvAuthority(profile, clubId) {
  if (!profile || profile.role !== 'admin' || profile.clubId !== clubId
    || !isClubWorkspace(profile) || profile.accountStatus !== 'active' || profile.clubStatus !== 'active'
    || profile.clubArchivedAt || profile.testerAccessExpired) {
    throw Object.assign(new Error('Only the active Club Admin can open their own club matchday display.'), { statusCode: 403 })
  }
}

export function createClubMatchdayTvHandler({ authenticate = getAuthenticatedPlanProfile, assertFeature = assertPlanFeature, client = supabaseAdmin, weather = getClubTvWeather, passwordClient = createPublicSupabaseClient, logger = console } = {}) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return reply(405, { message: 'Method not allowed.' })
    try {
      if (typeof event.body !== 'string' || event.body.length > 2048) return reply(400, { message: 'Invalid display request.' })
      let body
      try { body = JSON.parse(event.body) } catch { return reply(400, { message: 'Invalid display request.' }) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { message: 'Invalid display request.' })
      const clubId = String(body?.clubId ?? '').trim(), date = body?.date
      if (!uuid.test(clubId) || (!body.action && !validTvDate(date)) || (body.action && !['weather', 'unlock'].includes(body.action))) return reply(400, { message: 'Choose a valid club and match date.' })
      const profile = await authenticate(event, { clubId })
      assertClubTvAuthority(profile, clubId)
      // This is club-wide read access, independent of team-scoped scoring rights.
      await assertFeature(profile, 'clubAdministration')
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
      const matches = []
      // Stable pagination avoids the default Data API row cap dropping fixtures silently.
      for (let offset = 0; offset < 5000; offset += 250) {
        const { data, error } = await client.from('match_days').select(CLUB_TV_MATCH_SELECT)
          .eq('club_id', profile.clubId).eq('match_date', date).is('deleted_at', null)
          .order('kickoff_time', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).range(offset, offset + 249)
        if (error) throw error
        for (const row of data ?? []) { const match = toClubTvMatch(row, profile.clubId); if (match) matches.push(match) }
        if ((data ?? []).length < 250) return reply(200, { club: { id: club.id, name: club.name, logoUrl: club.logo_url || '', accent: club.theme_accent || 'green' }, date, matches, refreshedAt: new Date().toISOString() })
      }
      return reply(503, { message: 'This matchday is too large to display safely. Please contact support.' })
    } catch (error) {
      const status = [401, 403].includes(error?.statusCode) ? error.statusCode : 503
      logger.error('Club matchday TV request failed', { statusCode: status, code: error?.code || 'unavailable' })
      return reply(status, { message: status === 403 ? 'Access is restricted to your own active Club Admin workspace.' : status === 401 ? 'Sign in to open the club matchday display.' : 'Scores could not be refreshed. Please try again.' })
    }
  }
}

export const handler = createClubMatchdayTvHandler()
