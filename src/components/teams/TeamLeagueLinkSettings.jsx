import { useState } from 'react'
import { useTeamLeagueLink } from '../../../apps/mobile-core/src/useTeamLeagueLink.js'
import { coachTeamLeagueScope, normalizeTeamLeagueUrl, teamLeagueScopeKey } from '../../lib/team-league-link.js'
import { isPlanAccessActive } from '../../lib/plans.js'
import { supabase } from '../../lib/supabase-client.js'

export function TeamLeagueLinkSettings({ user, teamId }) {
  const scope = coachTeamLeagueScope(user, teamId, isPlanAccessActive(user))
  return teamId ? <TeamLeagueEditor key={teamLeagueScopeKey(scope)} scope={scope} /> : null
}

function TeamLeagueEditor({ scope }) {
  const league = useTeamLeagueLink(supabase, scope)
  const [draft, setDraft] = useState(null)
  const [message, setMessage] = useState('')
  const values = draft || { url: league.value?.url || '', enabled: league.value?.enabled === true }
  const canEdit = league.value?.canEdit === true && league.status === 'ready'
  const change = patch => { setMessage(''); setDraft({ ...values, ...patch }) }
  const save = async () => {
    try { normalizeTeamLeagueUrl(values.url) } catch (error) { setMessage(error.message); return }
    if (await league.save(values)) { setDraft(null); setMessage('League link saved.') }
  }
  return <div className="mt-4 space-y-3 border-t border-[#d7e5dc] pt-4">
    <h3 className="text-lg font-black text-[#101828]">Current league</h3>
    <p className="text-sm leading-6 text-[#4b5f55]">One league website for this team. Turn it off to hide it for Coaches, Parents and Players while keeping the saved address.</p>
    {league.status === 'loading' ? <p>Loading league link...</p> : null}
    {league.value?.canEdit ? <>
      <label className="block text-sm font-semibold">League website URL<input aria-label="Current league website URL" type="url" maxLength={2048} disabled={!canEdit} value={values.url} onChange={event => change({ url: event.target.value })} placeholder="https://" className="mt-2 min-h-12 w-full rounded-lg border border-[#d7e5dc] px-3" /></label>
      <label className="flex min-h-12 items-center gap-3 text-sm font-semibold"><input type="checkbox" disabled={!canEdit} checked={values.enabled} onChange={event => change({ enabled: event.target.checked })} />Show league link</label>
      <button type="button" disabled={!canEdit} onClick={() => { void save() }} className="min-h-12 px-3 font-bold text-[#047857] disabled:opacity-50">{league.status === 'saving' ? 'Saving...' : 'Save league link'}</button>
    </> : league.status === 'ready' ? <p className="text-sm text-[#4b5f55]">Only an assigned Team Admin can change this team's league link.</p> : null}
    {league.error || message ? <p role="status" className="text-sm">{league.error || message}</p> : null}
    {league.status === 'error' ? <button type="button" onClick={() => { void league.load() }} className="min-h-12 font-bold text-[#047857]">Retry league link</button> : null}
  </div>
}
