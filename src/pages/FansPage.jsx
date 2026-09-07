import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../lib/auth.js'
import { FAN_ACCESS, fanAccessSummary, fanInviteUrl, normalizeFanPermissions, validateFanInvite } from '../lib/fans.js'
import { fanRequest, fanRpc } from '../lib/fans-client.js'
import { useFans } from '../lib/use-fans.js'
import { FanIcon } from '../components/parent-portal/FanIcon.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { ParentPortalRouteShell } from '../components/parent-portal/ParentPortalShell.jsx'
import { buildParentAppUrl } from '../lib/app-origins.js'
import { FormationBoardPitch } from '../components/formation-board/FormationBoardPitch.jsx'
import './fans.css'

export function FansPage() {
  const { session, signOut, user } = useAuth()
  if (!session?.user) return <main className="fans"><h1>Fans</h1><p>Sign in to manage your Fans or view the children you follow.</p><Link to="/parent-login">Sign in</Link></main>
  const parents = (user?.parentPortalLinks || []).filter((link) => !['fan', 'family'].includes(link.linkType))
  return parents.length ? <ParentPortalRouteShell activeSection="fans" user={{ ...user, parentPortalLinks: parents }}><FansWorkspace key={session.user.id} user={user} signOut={signOut} /></ParentPortalRouteShell> : <FansWorkspace key={session.user.id} user={user} signOut={signOut} />
}
function FansWorkspace({ user, signOut }) {
  const state = useFans({ rpc: fanRpc, request: fanRequest })
  const { clearView } = state
  const parents = (user?.parentPortalLinks || []).filter((link) => link.linkType !== 'fan' && link.linkType !== 'family')
  const [parentId, setParentId] = useState(user?.selectedParentLinkId || parents[0]?.id || '')
  const [form, setForm] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(null)
  const [qr, setQr] = useState('')
  const requestId = useRef('')
  const selectedParent = parents.find((p) => p.id === parentId) || parents[0]
  useEffect(() => {
    const hide = () => { if (document.hidden) { clearView(); setQr(''); setReady(null) } }
    window.addEventListener('pagehide', clearView); document.addEventListener('visibilitychange', hide)
    return () => { window.removeEventListener('pagehide', clearView); document.removeEventListener('visibilitychange', hide) }
  }, [clearView])
  const run = async (action) => { setBusy(true); state.setError(''); try { await action() } catch (e) { state.setError(e.message) } finally { setBusy(false) } }
  const begin = (existing) => { setReady(null); setQr(''); requestId.current = crypto.randomUUID(); setForm(existing ? { id: existing.id, name: existing.name, email: existing.email, permissions: existing.permissions } : { name: '', email: '', permissions: normalizeFanPermissions({ game_day: true }) }) }
  const confirm = (mode) => { try { const draft = validateFanInvite(form); state.setError(''); setConfirmation({ ...draft, id: form.id, mode, parentId: selectedParent?.id, child: selectedParent?.playerName }) } catch (e) { state.setError(e.message) } }
  const complete = () => run(async () => {
    const draft = confirmation
    if (draft.id) await state.manage(draft.id, 'permissions', draft.permissions)
    else {
      const result = await fanRpc('create_fan_invitation', { parent_link_id_value: draft.parentId, name_value: draft.name, email_value: draft.email, permissions_value: draft.permissions, request_id_value: requestId.current })
      const url = fanInviteUrl(buildParentAppUrl('/'), result.invite_token)
      setReady({ ...result, url }); setForm(null); setConfirmation(null); await state.reload()
      if (draft.mode === 'email') await fanRequest({ action: 'send_invitation', connectionId: result.id })
      if (draft.mode === 'qr') setQr(await QRCode.toDataURL(url, { margin: 4, width: 300 }))
      if (draft.mode === 'share') { if (navigator.share) await navigator.share({ title: 'Fan invitation', url }); else await navigator.clipboard.writeText(url) }
    }
    setForm(null); setConfirmation(null); await state.reload()
  })
  return <main className="fans">
    <header className="fans-heading"><FanIcon /><div><h1>Fans</h1><p>Choose who follows your child and what they can see.</p></div></header>
    {parents.length ? <Link to="/parent-portal">Back to Parent portal</Link> : <button onClick={() => run(signOut)}>Sign out</button>}
    {state.error ? <p role="alert" className="fans-error">{state.error}</p> : null}
    {state.loading ? <p role="status">Loading Fans...</p> : null}
    {parents.length ? <section>
      <label>Child<select value={selectedParent?.id || ''} onChange={(e) => { setParentId(e.target.value); setForm(null); setReady(null); setQr('') }}>{parents.map((p) => <option value={p.id} key={p.id}>{p.playerName}</option>)}</select></label>
      <button className="fans-action" onClick={() => begin()}><FanIcon />Invite a Fan</button>
      {form ? <form onSubmit={(e) => { e.preventDefault(); confirm('email') }}>
        <label>Name<input autoComplete="name" required maxLength={120} disabled={Boolean(form.id)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Email<input autoComplete="email" type="email" required maxLength={254} disabled={Boolean(form.id)} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <fieldset><legend>Choose access</legend>{FAN_ACCESS.map((item) => <label className="fans-permission" key={item.key}><FanIcon name={item.key} /><span><strong>{item.label}</strong><small>{item.description}</small></span><input type="checkbox" checked={form.permissions[item.key]} disabled={item.key === 'resources' && !form.permissions.development} onChange={(e) => setForm({ ...form, permissions: normalizeFanPermissions({ ...form.permissions, [item.key]: e.target.checked }) })} /></label>)}</fieldset>
        <div className="fans-actions">{form.id ? <button disabled={busy} type="submit">Review changes</button> : <><button type="submit" disabled={busy}><FanIcon name="email" />Email</button><button type="button" disabled={busy} onClick={() => confirm('qr')}><FanIcon name="qr" />QR code</button><button type="button" disabled={busy} onClick={() => confirm('share')}><FanIcon name="share" />Share link</button></>}<button type="button" onClick={() => setForm(null)}>Cancel</button></div>
      </form> : null}
      {ready ? <div className="fans-ready"><p>Invitation ready for <strong>{ready.name}</strong> ({ready.email}). Expires {new Date(ready.expires_at).toLocaleString()}.</p>{qr ? <img src={qr} width="300" height="300" alt={`Invitation QR code for ${ready.name}`} /> : null}<div className="fans-actions"><button onClick={() => run(async () => { await navigator.clipboard.writeText(ready.url) })}>Copy link</button><button onClick={() => run(() => fanRequest({ action: 'send_invitation', connectionId: ready.id }))}>Send email</button></div></div> : null}
      <h2>Your child's Fans</h2>
      {state.connections.filter((c) => c.is_owner && c.parent_link_id === selectedParent?.id).map((c) => <div className="fans-person" key={c.id}><FanIcon /><div><strong>{c.name}</strong><small>{c.email}</small><small>{c.status} · {FAN_ACCESS.filter((p) => c.permissions[p.key]).map((p) => p.label).join(', ')}</small></div>{['pending', 'active'].includes(c.status) ? <div className="fans-actions"><button onClick={() => begin(c)}>Edit access</button><button onClick={() => setConfirmation({ remove: c, child: selectedParent.playerName })}>{c.status === 'pending' ? 'Cancel invitation' : 'Revoke access'}</button></div> : null}</div>)}
      {!state.connections.some((c) => c.is_owner && c.parent_link_id === selectedParent?.id) ? <p>No Fans invited for this child yet.</p> : null}
    </section> : null}
    <section><h2>Children you follow</h2>{state.connections.filter((c) => !c.is_owner && c.status === 'active').map((c) => <div className="fans-following" key={c.id}><div className="fans-person"><FanIcon /><div><strong>{c.player_name}</strong><small>{c.club_name} · {c.team_name}</small></div><button onClick={() => setConfirmation({ selfRemove: c })}>Remove my access</button></div><div className="fans-actions">{FAN_ACCESS.filter((p) => c.permissions[p.key]).map((p) => <button key={p.key} onClick={() => state.open(c.id, p.key === 'game_day' ? 'matches' : p.key)}><FanIcon name={p.key} />{p.label}</button>)}{c.permissions.game_day ? <><button onClick={() => state.open(c.id, 'notifications')}>Notifications</button><label><input type="checkbox" checked={c.notifications_enabled} onChange={(e) => run(() => state.manage(c.id, e.target.checked ? 'notifications_on' : 'notifications_off'))} />Receive Game Day notifications</label></> : null}</div></div>)}</section>
    {state.view ? <FanContent key={`${state.view.connectionId}:${state.view.action}`} state={state} run={run} /> : null}
    <ConfirmModal isOpen={Boolean(confirmation)} isBusy={busy} title={confirmation?.selfRemove ? 'Remove my access' : confirmation?.remove ? 'End Fan access' : 'Confirm Fan access'} cancelLabel="Go back" confirmLabel={confirmation?.remove || confirmation?.selfRemove ? 'Remove access' : confirmation?.id ? 'Confirm changes' : 'Confirm invitation'} onCancel={() => setConfirmation(null)} onConfirm={() => confirmation?.remove || confirmation?.selfRemove ? run(async () => { const c = confirmation.remove || confirmation.selfRemove; await state.manage(c.id, confirmation.selfRemove ? 'remove' : 'revoke'); setConfirmation(null) }) : complete()}>
      {confirmation?.remove || confirmation?.selfRemove ? <p>Access to this child and associated notifications will end. A new invitation will be needed to restore access.</p> : confirmation ? <><p>{confirmation.id ? 'You are updating access for' : 'You are inviting'} <strong>{confirmation.name} ({confirmation.email})</strong> to follow <strong>{confirmation.child}</strong>.</p><ul>{fanAccessSummary(confirmation.permissions).map((line) => <li key={line}>{line}</li>)}</ul><p>This person cannot invite others, use parent chat, respond to attendance or change your child's information. Either of you can end this access.</p></> : null}
    </ConfirmModal>
  </main>
}
function FanContent({ state, run }) {
  const data = state.content
  const [resource, setResource] = useState(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const openResource = (item) => run(async () => {
    const result = await fanRequest({ action: 'open_resource', connectionId: state.view.connectionId, resourceId: item.id })
    if (active.current) setResource({ ...result, title: item.title, id: item.id })
  })
  const board = resource?.formationBoard
  return <section className="fans-content"><button onClick={state.clearView}>Close view</button>{!data ? <p role="status">Loading...</p> : <>
    {(data.matches || []).map((m) => <button className="fans-person" key={m.id} onClick={() => state.open(state.view.connectionId, 'matches', { matchId: m.id })}><FanIcon name="game_day" /><span><strong>{m.opponent}: {m.home_score} : {m.away_score}</strong><small>{m.match_date} · {m.kickoff_time_tbc ? 'Time TBC' : m.kickoff_time} · {m.status}</small></span></button>)}
    {(data.events || []).map((e) => <p key={e.id}>{e.minute == null ? '' : `${e.minute} min · `}{e.event_type.replaceAll('_', ' ')} · {e.home_score} : {e.away_score}</p>)}
    {(data.schedule || []).map((e) => <div className="fans-person" key={e.id}><FanIcon name="schedule" /><div><strong>{e.title}</strong><small>{e.starts_at ? new Date(e.starts_at).toLocaleString() : `${e.date} ${e.time || 'Time TBC'}`}</small><small>{e.location}{e.recurrence_frequency && e.recurrence_frequency !== 'none' ? ` · Repeats ${e.recurrence_frequency}${e.recurrence_until ? ` until ${e.recurrence_until}` : ''}` : ''}</small></div></div>)}
    {(data.notifications || []).map((n) => <div key={n.id}><strong>{n.title}</strong><p>{n.body}</p></div>)}
    {(data.reports || []).map((r) => <details key={r.id}><summary>{r.form?.name || 'Development report'} · {r.recordDate}</summary><p>{r.overallScore == null ? '' : `Overall ${r.overallScore} / ${r.overallMaxScore}`}</p>{r.responseItems?.map((item, i) => <p key={i}><strong>{item.label || item.question}</strong> {item.displayValue || item.value || item.answer || item.score}</p>)}{r.sections?.map((s, i) => <div key={i}><strong>{s.title}</strong><p>{s.body || s.text}</p>{s.chartPoints?.map((point, n) => <p key={n}>{point.label}: {point.value}</p>)}</div>)}</details>)}
    {(data.resources || []).map((r) => <button className="fans-person" key={r.id} onClick={() => openResource(r)}><FanIcon name="resources" /><span>{r.title}</span></button>)}
    {resource && data.resources?.some((r) => r.id === resource.id) ? <div>
      <h3>{resource.title}</h3><button onClick={() => setResource(null)}>Close resource</button>
      {board ? <><p>{board.description}</p><FormationBoardPitch canEdit={false} hasPlacementSource={false} placements={board.placements || []} /><h4>Bench</h4>{(board.bench || []).map((p) => <p key={p.playerId}>{p.displayName || p.playerName}</p>)}<p>{board.notes}</p></> : /^https:\/\//.test(resource.accessUrl || '') ? <a href={resource.accessUrl} target="_blank" rel="noopener noreferrer">Open {resource.title}</a> : <p>This resource could not be opened.</p>}
    </div> : null}
    {!Object.values(data).some((v) => Array.isArray(v) && v.length) ? <p>No shared items are available.</p> : null}
  </>}</section>
}
