import { useState } from 'react'
import { previewPlanChange } from '../../lib/plan-change-preview.js'

export function PlanInsights({ currentPlanKey, insights, loading = false }) {
  const [target, setTarget] = useState('matchday')
  const [clubCapacity, setClubCapacity] = useState(10)
  if (loading) return <p role="status">Loading plan usage.</p>
  if (!insights) return <p role="status">Plan usage is unavailable. Reload billing to try again.</p>
  const preview = previewPlanChange({ currentPlanKey, targetPlanKey: target, teamCapacity: target === 'club' ? clubCapacity : 1, usage: insights, matchdayPolicy: insights.matchdayPolicy })
  const displayCount = count => Number.isInteger(count) ? count : 'Unavailable'
  return (
    <section className="space-y-5 border-y border-[var(--border-color)] py-5" aria-label="Plan usage and change preview">
      <div>
        <h2 className="text-lg font-black text-[var(--text-primary)]">Plan usage</h2>
        <dl className="divide-y divide-[var(--border-color)] text-sm">
          <div className="flex justify-between gap-3 py-3"><dt>Active teams</dt><dd>{displayCount(insights.teams)} / {insights.teamCapacityUnlimited ? 'Unlimited' : displayCount(insights.teamCapacity)}</dd></div>
          <div className="flex justify-between gap-3 py-3"><dt>Active players</dt><dd>{displayCount(insights.players)}</dd></div>
        </dl>
        {Number.isInteger(insights.teams) && Number.isInteger(insights.teamCapacity) ? <p className="text-sm text-[var(--text-muted)]">{Math.max(0, insights.teamCapacity - insights.teams)} team spaces available{insights.teams > insights.teamCapacity ? '. Current usage exceeds the plan allowance' : ''}.</p> : null}
      </div>
      <div className="space-y-3">
        <h2 className="text-lg font-black text-[var(--text-primary)]">Preview a plan change</h2>
        <p className="text-sm text-[var(--text-muted)]">See which features and team allowance would change. This preview does not change your subscription or delete records. Existing role restrictions still apply.</p>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-bold">Preview plan
          <select value={target} onChange={event => setTarget(event.target.value)} className="min-h-11 rounded border border-[var(--border-color)] bg-[var(--panel-bg)] p-2">
            <option value="matchday">Matchday</option><option value="team">Team</option><option value="club">Club</option>
          </select>
        </label>
        {target === 'club' ? <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-bold">Preview team capacity
          <select value={clubCapacity} onChange={event => setClubCapacity(Number(event.target.value))} className="min-h-11 rounded border border-[var(--border-color)] bg-[var(--panel-bg)] p-2">
            {Array.from({ length: 50 }, (_, index) => (index + 1) * 10).map(capacity => <option key={capacity} value={capacity}>{capacity} teams</option>)}
          </select>
        </label> : null}
        <div aria-live="polite" className="space-y-2 text-sm">
          {!preview.available ? <p>{preview.reason}</p> : <>
            <p>Target allowance: {preview.includedTeams} {preview.includedTeams === 1 ? 'team' : 'teams'}.</p>
            {!preview.capacityVerified ? <p>Team usage could not be verified. Capacity eligibility is unknown.</p> : preview.excessTeams > 0 ? <p role="status">{preview.excessTeams} active {preview.excessTeams === 1 ? 'team exceeds' : 'teams exceed'} this allowance. Resolve team capacity before requesting this change.</p> : <p>Your current teams fit this allowance.</p>}
            {preview.lostFeatures.length ? <details><summary className="min-h-11 cursor-pointer py-3 font-bold">Features no longer included ({preview.lostFeatures.length})</summary><ul className="list-disc space-y-1 pl-5">{preview.lostFeatures.map(feature => <li key={feature.key}>{feature.label}</li>)}</ul></details> : <p>No currently available plan features would be removed.</p>}
            <p className="text-[var(--text-muted)]">This is an access preview. Billing dates and any price adjustments must be confirmed when the plan change is arranged.</p>
          </>}
        </div>
      </div>
    </section>
  )
}
