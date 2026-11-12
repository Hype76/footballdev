import { useCallback, useEffect, useRef, useState } from 'react'
import { formatUkDate } from '../../lib/date-format.js'
import { getMatchDayPhaseLabel } from '../../lib/matchday-extended-ops.js'
import {
  getPlatformMatchDaySupportActions,
  getPlatformMatchDaySupportError,
  PLATFORM_MATCH_DAY_PAGE_SIZE,
} from '../../lib/platform-match-day-support.js'
import { supabase } from '../../lib/supabase.js'
import { ConfirmModal } from '../ui/ConfirmModal.jsx'

const actionClass = 'min-h-11 rounded-lg border border-[var(--border-color)] px-3 text-sm font-semibold disabled:opacity-60'

export function PlatformMatchDaySupport({ club }) {
  const [teamId, setTeamId] = useState('')
  const teams = (club.teams || []).filter((team) => team.status === 'active' && !team.archivedAt)
  const team = teams.find((item) => item.id === teamId)
  if (club.status !== 'active' || club.archivedAt || !teams.length) return null

  return (
    <section className="mt-6 space-y-3 border-t border-[var(--border-color)] pt-5">
      <h3 className="text-lg font-bold">Match Day support</h3>
      <label className="block max-w-md space-y-1 text-sm font-semibold">
        <span>Team for Match Day support</span>
        <select className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3" value={team?.id || ''} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">Choose a team</option>
          {teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {team ? <TeamMatches key={`${club.id}:${team.id}`} clubId={club.id} team={team} /> : null}
    </section>
  )
}

function TeamMatches({ clubId, team }) {
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState({ rows: [], loading: true, error: '' })
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const loadGeneration = useRef(0)
  const mounted = useRef(false)
  const saving = useRef(false)

  const load = useCallback(async (pageOffset) => {
    const generation = ++loadGeneration.current
    setResult({ rows: [], loading: true, error: '' })
    try {
      const { data, error } = await supabase.rpc('platform_list_match_day_support', {
        club_id_value: clubId, team_id_value: team.id, offset_value: pageOffset,
      })
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Unexpected fixture list')
      if (loadGeneration.current === generation) setResult({ rows: data, loading: false, error: '' })
    } catch (error) {
      const message = error?.code === '42501' ? 'This team is unavailable. Check your Platform Admin access.'
        : 'Match Day could not be loaded. Try refreshing.'
      if (loadGeneration.current === generation) setResult({ rows: [], loading: false, error: message })
    }
  }, [clubId, team.id])

  useEffect(() => {
    mounted.current = true
    void load(offset)
    return () => { mounted.current = false; loadGeneration.current += 1 }
  }, [load, offset])

  async function confirmAction() {
    if (!pending || saving.current) return
    saving.current = true
    setBusy(true)
    setFeedback('')
    try {
      const { error } = await supabase.rpc('platform_apply_match_day_support_action', {
        club_id_value: clubId, team_id_value: team.id, match_day_id_value: pending.match.id,
        expected_updated_at_value: pending.match.updatedAt, action_value: pending.action,
      })
      if (error) throw error
      if (mounted.current) setFeedback('Match Day updated.')
    } catch (error) {
      if (mounted.current) setFeedback(getPlatformMatchDaySupportError(error))
    } finally {
      saving.current = false
      if (mounted.current) {
        setPending(null)
        setBusy(false)
        await load(offset)
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">Today’s fixtures and unfinished matches for {team.name}</p>
        <button type="button" className={actionClass} disabled={busy || result.loading} onClick={() => void load(offset)}>Refresh matches</button>
      </div>
      {result.loading ? <p role="status">Loading matches.</p> : null}
      {result.error ? <p role="alert">{result.error}</p> : null}
      {feedback ? <p role="status">{feedback}</p> : null}
      {!result.loading && !result.error && !result.rows.length ? <p>No matches to manage on this page.</p> : null}
      <ul className="divide-y divide-[var(--border-color)]">
        {result.rows.slice(0, PLATFORM_MATCH_DAY_PAGE_SIZE).map((match) => {
          const fixtureName = match.homeAway === 'away' ? `${match.opponent} v ${team.name}` : `${team.name} v ${match.opponent}`
          const actions = getPlatformMatchDaySupportActions(match)
          return (
            <li key={match.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong>{fixtureName}</strong>
                <span>{match.homeScore ?? 0}–{match.awayScore ?? 0}</span>
                <span className="text-sm">{formatUkDate(match.matchDate)} · {getMatchDayPhaseLabel(match) || 'Scheduled'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {actions.map(({ action, label }) => (
                  <button key={action} type="button" className={actionClass} disabled={busy}
                    onClick={() => setPending({ match, fixtureName, action, label })}>{label}</button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      {offset > 0 || result.rows.length > PLATFORM_MATCH_DAY_PAGE_SIZE ? (
        <div className="flex gap-2">
          <button type="button" className={actionClass} disabled={offset === 0 || busy || result.loading} onClick={() => setOffset(offset - PLATFORM_MATCH_DAY_PAGE_SIZE)}>Previous matches</button>
          <button type="button" className={actionClass} disabled={result.rows.length <= PLATFORM_MATCH_DAY_PAGE_SIZE || busy || result.loading} onClick={() => setOffset(offset + PLATFORM_MATCH_DAY_PAGE_SIZE)}>Next matches</button>
        </div>
      ) : null}
      <ConfirmModal
        isOpen={Boolean(pending)} isBusy={busy} title={pending?.label} confirmLabel={pending?.label}
        message={pending && (pending.action === 'end_shootout_without_result'
          ? `End ${pending.fixtureName} without a shootout winner? Recorded shootout kicks will be voided.`
          : `Apply this action to ${pending.fixtureName} as Platform Admin?`)}
        onCancel={() => setPending(null)} onConfirm={confirmAction}
      />
    </div>
  )
}
