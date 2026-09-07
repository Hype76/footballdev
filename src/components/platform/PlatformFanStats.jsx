import { useEffect, useState } from 'react'
import { fanRpc } from '../../lib/fans-client.js'
const fields = { uniqueFans: 'Unique active Fans', fanConnections: 'Active Fan connections', uniquePlayers: 'Player accounts', playerConnections: 'Player connections', uniqueAccounts: 'Unique accounts across both types', pending: 'Pending invitations', accepted: 'Accepted invitations', expired: 'Expired invitations', cancelled: 'Cancelled invitations', revoked: 'Revoked by Parent', removed: 'Removed by Fan' }
export function PlatformFanStats() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; fanRpc('get_platform_fan_stats').then((data) => { if (active) setStats(data) }).catch(() => { if (active) setError('Fan statistics are unavailable.') }); return () => { active = false } }, [])
  return <section className="p-4"><h2 className="text-lg font-black">Fans and Player accounts</h2><p className="text-sm">An account can have more than one relationship. Unique accounts are counted once across these categories.</p>{error ? <p role="alert">{error}</p> : !stats ? <p>Loading...</p> : <dl className="divide-y">{Object.entries(fields).map(([key, label]) => <div key={key} className="flex justify-between gap-4 py-3"><dt>{label}</dt><dd className="font-bold">{Number(stats[key] || 0).toLocaleString()}</dd></div>)}</dl>}</section>
}
