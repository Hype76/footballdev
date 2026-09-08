import { useEffect, useState } from 'react'
import { fanRpc } from '../../lib/fans-client.js'
import { FanIcon } from '../parent-portal/FanIcon.jsx'

const formatCount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : 'Unavailable'
function Counts({ values, fields }) {
  return <dl className="divide-y divide-[var(--border-color)]">{Object.entries(fields).map(([key, label]) => <div key={key} className="flex justify-between gap-4 py-2"><dt>{label}</dt><dd className="shrink-0 font-black tabular-nums">{formatCount(values?.[key])}</dd></div>)}</dl>
}

export function PlatformFanStats({ refreshKey = 0 }) {
  const [result, setResult] = useState(null)
  const [retryKey, setRetryKey] = useState(0)
  const current = result?.refreshKey === refreshKey && result?.retryKey === retryKey
  const stats = current ? result.stats : null
  const error = current ? result.error : ''
  useEffect(() => {
    let active = true
    fanRpc('get_platform_fan_stats').then((data) => {
      if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Invalid stats')
      if (active) setResult({ refreshKey, retryKey, stats: data, error: '' })
    }).catch(() => { if (active) setResult({ refreshKey, retryKey, stats: null, error: 'Fan statistics are unavailable. Please try again.' }) })
    return () => { active = false }
  }, [refreshKey, retryKey])
  return <section aria-labelledby="platform-fans-title" className="min-w-0 p-4 text-[var(--text-primary)]">
    <div className="flex items-center justify-between gap-3"><h2 id="platform-fans-title" className="flex items-center gap-2 text-lg font-black"><FanIcon />Fans and Player accounts</h2><button type="button" className="min-h-11 font-bold text-[var(--accent)]" onClick={() => setRetryKey((value) => value + 1)}>Refresh Fans</button></div>
    <p className="my-2 text-sm text-[var(--text-muted)]">Platform-wide totals, including demo and test clubs. Each active account is counted once per relationship type.</p>
    {error ? <p role="alert">{error}</p> : !stats ? <p role="status">Loading Fan statistics...</p> : <div className="space-y-4 text-sm">
      <Counts values={stats} fields={{ uniqueFans: 'Unique active Fans', fanConnections: 'Active Fan connections' }} />
      <details open><summary className="min-h-11 cursor-pointer py-3 font-black">Fan invitation progress</summary>
        <Counts values={stats.fanInvitations} fields={{ total: 'Total Fan invitations', pending: 'Pending invitations' }} />
        <p className="mt-3 text-[var(--text-muted)]">Pending invitations by signup stage. An existing account can be ready to accept without a new signup.</p>
        <Counts values={stats.fanSignup} fields={{ noAccount: 'No account yet', emailUnconfirmed: 'Email awaiting confirmation', readyToAccept: 'Ready to accept', unavailable: 'Access no longer available' }} />
        <p className="mt-3 text-[var(--text-muted)]">No account yet does not necessarily mean signup failed. Expired invitations are listed below.</p>
        <Counts values={stats.fanInvitations} fields={{ accepted: 'Accepted invitations, all time', expired: 'Expired invitations', cancelled: 'Cancelled invitations', revoked: 'Revoked by Parent', removed: 'Removed by Fan' }} />
        <p className="mt-2 text-[var(--text-muted)]">Accepted includes access later revoked or removed. Deleting a cancelled invitation from the Parent list preserves these totals.</p>
      </details>
      <details><summary className="min-h-11 cursor-pointer py-3 font-black">Fan phone notifications</summary>
        <Counts values={stats.fanNotifications} fields={{ enabledAccounts: 'Fans with Game Day alerts enabled', registeredAccounts: 'Of these, registered for phone alerts' }} />
        <p className="mt-2 text-[var(--text-muted)]">Counts accounts, not devices. A saved phone registration does not prove notification delivery.</p>
      </details>
      <details><summary className="min-h-11 cursor-pointer py-3 font-black">Player accounts</summary>
        <Counts values={stats} fields={{ uniquePlayers: 'Unique active Player accounts', playerConnections: 'Active Player connections', uniqueAccounts: 'Unique accounts across Fans and Players' }} />
        <p className="mt-2 text-[var(--text-muted)]">Reserved for future Player access. An account with both relationships is counted once in the combined total.</p>
      </details>
    </div>}
  </section>
}
