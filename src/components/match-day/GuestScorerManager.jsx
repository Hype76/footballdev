import { supabase } from '../../lib/supabase-client.js'
import { requestGuestScorer } from '../../lib/guest-scorer.js'
import { useGuestScorerManagement } from '../../lib/use-guest-scorer-management.js'
async function request(body) {
  const { data } = await supabase.auth.getSession()
  return requestGuestScorer(body, { token: data.session?.access_token })
}
export function GuestScorerManager({ match }) {
  const { guest, busy, error, run } = useGuestScorerManagement(match.id, request)
  if (['full_time', 'cancelled', 'postponed'].includes(match.status) || match.concludedAt) return null
  const button = 'my-2 mr-2 rounded-lg border border-teal-600 px-4 py-3 font-bold'
  return <section className="my-4 border-t border-slate-200 py-4">
    <h4 className="text-lg font-black">Guest scorer</h4>
    <p className="my-2 text-sm">Someone at the pitch can score this match without an account. Ask them to scan, enter their name and wait for your approval.</p>
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    {guest?.status === 'offered' && guest.qr ? <><img src={guest.qr} alt="Scan to request guest scorer access" width="260" height="260" /><p>Single use. Expires in ten minutes.</p></> : null}
    {guest?.status === 'pending' ? <><p className="my-2 font-bold">{guest.name} is asking to score. Check this is the person beside you.</p><button disabled={busy} className={button} onClick={() => run('approve', guest.id)}>Approve {guest.name}</button></> : null}
    {guest?.status === 'approved' ? <p className="my-2 font-bold">{guest.name} can score this match.</p> : null}
    {['offered', 'pending', 'approved'].includes(guest?.status)
      ? <button disabled={busy} className={button} onClick={() => run('revoke', guest.id)}>Remove guest access</button>
      : <button disabled={busy} className={button} onClick={() => run('create')}>Add guest scorer</button>}
  </section>
}
