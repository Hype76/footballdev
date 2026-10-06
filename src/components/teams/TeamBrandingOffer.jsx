import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase-client.js'
import { formatUkDate } from '../../lib/date-format.js'

const actionClass = 'min-h-11 px-3 py-2 text-sm font-bold underline underline-offset-4 disabled:opacity-50'
export function TeamBrandingOffer({ teamId, teamName, isPlatformAdmin = false }) {
  const [state, setState] = useState(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [accent, setAccent] = useState('#047857')
  const [file, setFile] = useState(null)
  const [reason, setReason] = useState('')
  async function request(action, extra = {}, signal) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sign in to manage team branding.')
    const result = await fetch('/.netlify/functions/manage-team-branding', {
      method: 'POST', signal, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, teamId, ...extra }),
    })
    const value = await result.json()
    if (!result.ok) throw new Error(value.message || 'Team branding could not be updated.')
    return value
  }
  useEffect(() => {
    const controller = new AbortController()
    setState(null); setAccepted(false); setMessage(''); setFile(null); setReason('')
    if (teamId) request('read', {}, controller.signal).then(value => {
      if (!controller.signal.aborted) { setState(value); setAccent(value.accent?.startsWith('#') ? value.accent : '#047857') }
    }).catch(() => { /* Dormant/uninstalled or unavailable offers stay hidden. */ })
    return () => controller.abort()
    // Each selection creates a fresh scoped request and discards the previous response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])
  async function act(action) {
    setBusy(true); setMessage('')
    try {
      if (action === 'claim' && state.claimAllowed !== true) throw new Error('New promotional places are available to Matchday teams only.')
      const extra = action === 'claim' ? { termsVersion: state.termsVersion } : action === 'extend' ? { reason } : state.coloursAllowed ? { accent } : {}
      if (action === 'save' && file) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Choose a logo smaller than 5 MB.')
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file)
        })
        Object.assign(extra, { dataBase64: String(dataUrl).split(',')[1], mimeType: file.type, fileName: file.name })
      }
      setState(await request(action, extra)); setMessage('Team branding updated.'); setFile(null)
    } catch (error) { setMessage(error.message || 'Team branding could not be updated.') }
    finally { setBusy(false) }
  }
  if (!state?.enabled) return null
  return <section aria-label="Team branding promotion" className="border-t border-[#d7e5dc] py-3">
    <h2 className="text-base font-bold">Branding for {teamName || 'this team'}</h2>
    <p className="py-2 text-sm">{state.state === 'grandfathered' || state.state === 'permanent' ? 'Permanent promotional branding' : state.state === 'failed' ? 'The qualification window has ended. Saved artwork is retained.' : state.state === 'provisional' ? `Qualify by ${formatUkDate(state.deadlineAt)}: ${state.playersWithAcceptedParent}/7 players with accepted Parent links and ${state.completedMatches}/10 completed matches.` : 'First 250 teams: claim team logo and colours.'}</p>
    {state.state === 'unclaimed' && state.claimAllowed !== true && <p className="text-sm">New promotional places are available to Matchday teams only.</p>}
    {state.state === 'unclaimed' && state.claimAllowed === true && <>
      <p className="text-sm">Three calendar months from claiming to reach seven active players with accepted Parent links and ten completed matches. Branding becomes permanent when both are met. Otherwise promotional display ends; your artwork is kept. One place per team.</p>
      <label className="flex min-h-11 items-center gap-3 py-2 text-sm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I accept these offer terms ({state.termsVersion}).</label>
      <button className={actionClass} disabled={!accepted || busy} onClick={() => act('claim')}>Claim this team’s place</button>
    </>}
    {(state.logoAllowed || state.coloursAllowed) && <div className="divide-y divide-[#d7e5dc]">
      {state.logoAllowed && <label className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm">Team logo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} /></label>}
      {state.coloursAllowed && <label className="flex min-h-11 items-center justify-between py-2 text-sm">Team colour<input aria-label="Team colour" type="color" value={accent} disabled={busy} onChange={event => setAccent(event.target.value)} className="h-11 w-16" /></label>}
      <button className={actionClass} disabled={busy || (!state.coloursAllowed && !file)} onClick={() => act('save')}>Save branding</button>
    </div>}
    {isPlatformAdmin && state.state === 'provisional' && !state.extensionUsed && <details className="border-t border-[#d7e5dc] py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Extend by one calendar month</summary>
      <label className="block text-sm">Audit reason<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} className="min-h-11 w-full border-b py-2" /></label>
      <button className={actionClass} disabled={busy || !reason.trim()} onClick={() => act('extend')}>Apply extension</button>
    </details>}
    <p role="status" className="text-sm">{busy ? 'Updating team branding...' : message}</p>
  </section>
}
