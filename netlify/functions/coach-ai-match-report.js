import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import {
  buildCoachAiFacts, buildCoachAiPrompt, canUseCoachAiReport,
  validateCoachAiAnswers, validateCoachAiNarrative,
} from './lib/_coach-ai-report.js'

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const envValue = (name) => globalThis.Netlify?.env?.get?.(name) || process.env[name]

export default async function coachAiMatchReport(request) {
  if (request.method !== 'POST') return json(405, { message: 'Method not allowed.' })
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return json(401, { message: 'Login is required.' })
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !auth?.user) return json(401, { message: 'Login is required.' })

    const body = await request.json()
    const matchDayId = String(body?.matchDayId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(matchDayId)) return json(400, { message: 'Choose a valid match.' })
    if (!['generate', 'save'].includes(body?.action)) return json(400, { message: 'Choose a valid report action.' })

    const { data: match, error: matchError } = await supabaseAdmin.from('match_days')
      .select('*, teams:team_id(name), clubs:club_id(name)')
      .eq('id', matchDayId).maybeSingle()
    if (matchError) throw matchError
    if (!match) return json(404, { message: 'Match Day could not be found.' })
    const profile = await loadActiveAuthorityProfile(supabaseAdmin, auth.user, { clubId: match.club_id })
    if (!canUseCoachAiReport(match, auth.user.id, profile)) {
      return json(403, { message: 'Only the person who concluded this pilot match can use its AI report.' })
    }
    const client = createClient(envValue('VITE_SUPABASE_URL'), envValue('VITE_SUPABASE_PUBLISHABLE_KEY') || envValue('VITE_SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    const { data: canReadMatch, error: accessError } = await client.rpc('can_read_match_day', { target_team_id: match.team_id })
    if (accessError) throw accessError
    if (!canReadMatch) return json(403, { message: 'You no longer have access to this match.' })
    const answers = validateCoachAiAnswers(body.answers || {})

    if (body.action === 'save') {
      const narrative = validateCoachAiNarrative(body.narrative)
      const { data, error } = await client.rpc('save_match_day_ai_report', {
        match_day_id_value: match.id,
        narrative_value: narrative,
        answers_value: answers,
      })
      if (error) throw error
      return json(200, { narrative: data.ai_narrative, savedAt: data.ai_saved_at })
    }

    const apiKey = envValue('OPENAI_API_KEY')
    if (!apiKey) return json(503, { message: 'AI report generation is not configured yet.' })
    const [{ data: events, error: eventsError }, { data: kicks, error: kicksError }] = await Promise.all([
      supabaseAdmin.from('match_day_events').select('*').eq('match_day_id', match.id).order('created_at'),
      supabaseAdmin.from('match_day_shootout_kicks').select('*').eq('match_day_id', match.id).order('kick_number'),
    ])
    if (eventsError || kicksError) throw eventsError || kicksError
    const facts = buildCoachAiFacts(match, events || [], kicks || [])
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: envValue('OPENAI_MATCH_REPORT_MODEL') || 'gpt-5.6-luna',
        input: buildCoachAiPrompt(facts, answers),
        reasoning: { effort: 'none' },
        max_output_tokens: 1400,
        store: false,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      console.error('OpenAI match report request failed:', response.status)
      return json(502, { message: 'The report could not be generated. Please try again.' })
    }
    const result = await response.json()
    const narrative = result.output?.flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text').map((item) => item.text).join('\n').trim()
    if (!narrative) return json(502, { message: 'The report came back empty. Please try again.' })
    return json(200, { narrative: validateCoachAiNarrative(narrative) })
  } catch (error) {
    console.error('Coach AI report failed:', error?.message)
    return json(error?.statusCode || 500, { message: error?.statusCode === 403 ? error.message : 'The report could not be completed. Please try again.' })
  }
}

export const config = { path: '/.netlify/functions/coach-ai-match-report' }
