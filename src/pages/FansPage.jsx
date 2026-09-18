import { UserFeedbackLinks } from '../components/layout/UserFeedbackLinks.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../lib/auth.js'
import { FAN_ACCESS, fanAccessSummary, fanInviteUrl, getFanAccessForPlan, isFanAccessAllowedForPlan, normalizeFanPermissions, restrictFanPermissionsForPlan, validateFanInvite } from '../lib/fans.js'
import { fanRequest, fanRpc } from '../lib/fans-client.js'
import { useFans } from '../lib/use-fans.js'
import { FanIcon } from '../components/parent-portal/FanIcon.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { ParentPortalRouteShell } from '../components/parent-portal/ParentPortalShell.jsx'
import { buildParentAppUrl } from '../lib/app-origins.js'
import { FormationBoardPitch } from '../components/formation-board/FormationBoardPitch.jsx'
import { FanBrandScope, FanClubBrand } from '../components/parent-portal/FanBrand.jsx'
import { formatParentProductDateTime, formatParentProductTime } from '../../apps/mobile-core/src/parentDateTimeCore.js'
import { upcomingFanSchedule } from '../lib/fan-schedule.js'
import { useMatchdayPolicy } from '../lib/use-matchday-policy.js'
import './fans.css'

export function FansPage() {
  const { session, signOut, user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const parentId = searchParams.get('parentLinkId') || ''
  const setParentId = (id) => setSearchParams((current) => { const next = new URLSearchParams(current); next.set('parentLinkId', id); return next }, { replace: true })
  if (!session?.user) return <main className="fans"><h1>Fans</h1><p>Sign in to manage your Fans or view the players you follow.</p><Link to="/parent-login">Sign in</Link></main>
  const parents = (user?.parentPortalLinks || []).filter((link) => !['fan', 'family'].includes(link.linkType))
  return parents.length ? <ParentPortalRouteShell activeSection="fans" selectedParentLinkId={parentId} onSelectedParentLinkChange={setParentId} user={{ ...user, parentPortalLinks: parents }}><FansWorkspace key={session.user.id} user={user} signOut={signOut} parentId={parentId} setParentId={setParentId} /></ParentPortalRouteShell> : <FansWorkspace key={session.user.id} user={user} signOut={signOut} parentId={parentId} setParentId={setParentId} />
}
function FansWorkspace({ user, signOut, parentId, setParentId }) {
  const state = useFans({ rpc: fanRpc, request: fanRequest })
  const { clearView } = state
  const parents = (user?.parentPortalLinks || []).filter((link) => link.linkType !== 'fan' && link.linkType !== 'family')
  const [section, setSection] = useState('players')
  const [form, setForm] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(null)
  const [qr, setQr] = useState('')
  const requestId = useRef('')
  const selectedParent = parents.find((p) => p.id === parentId) || parents[0]
  const followed = state.connections.filter((c) => !c.is_owner && c.status === 'active')
  const hasMatchdayConnection = [...parents, ...state.connections].some((connection) => String(connection?.planKey || connection?.plan_key || '').toLowerCase() === 'matchday')
  const matchdayPolicyUser = useMemo(() => ({ ...user, planKey: hasMatchdayConnection ? 'matchday' : user?.planKey }), [hasMatchdayConnection, user])
  const matchdayPolicy = useMatchdayPolicy(matchdayPolicyUser)
  const ownerAccess = getFanAccessForPlan(selectedParent, matchdayPolicy)
  const navigate = (next) => { clearView(); setSection(next); setForm(null); setReady(null); setQr('') }
  const brandSource = state.connections.find((c) => c.id === state.view?.connectionId) || selectedParent || state.connections.find((c) => !c.is_owner && c.status === 'active')
  useEffect(() => {
    const hide = () => { if (document.hidden) { clearView(); setQr(''); setReady(null) } }
    window.addEventListener('pagehide', clearView); document.addEventListener('visibilitychange', hide)
    return () => { window.removeEventListener('pagehide', clearView); document.removeEventListener('visibilitychange', hide) }
  }, [clearView])
  useEffect(() => {
    if (!state.view) return
    const connection = state.connections.find((item) => item.id === state.view.connectionId)
    if (connection && !isFanAccessAllowedForPlan(connection, state.view.action, matchdayPolicy)) {
      state.clearView()
      state.setError('That section is not available for this player\'s team plan.')
    }
  }, [matchdayPolicy, state, state.connections, state.view])
  const run = async (action) => { setBusy(true); state.setError(''); try { await action() } catch (e) { state.setError(e.message) } finally { setBusy(false) } }
  const begin = (existing) => {
    clearView(); setReady(null); setQr(''); requestId.current = crypto.randomUUID()
    const permissions = existing?.permissions || { game_day: ownerAccess.some((item) => item.key === 'game_day'), schedule: ownerAccess.some((item) => item.key === 'schedule') }
    setForm(existing ? { id: existing.id, name: existing.name, email: existing.email, permissions: restrictFanPermissionsForPlan(permissions, selectedParent, matchdayPolicy) } : { name: '', email: '', permissions: restrictFanPermissionsForPlan(permissions, selectedParent, matchdayPolicy) })
  }
  const confirm = (mode) => { try { const draft = validateFanInvite({ ...form, permissions: restrictFanPermissionsForPlan(form?.permissions, selectedParent, matchdayPolicy) }); state.setError(''); setConfirmation({ ...draft, id: form.id, mode, parentId: selectedParent?.id, child: selectedParent?.playerName }) } catch (e) { state.setError(e.message) } }
  const openFanSection = (connection, action, details) => {
    if (!isFanAccessAllowedForPlan(connection, action, matchdayPolicy)) {
      state.clearView()
      state.setError('That section is not available for this player\'s team plan.')
      return
    }
    state.open(connection.id, action, details)
  }
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
  return <FanBrandScope source={brandSource} matchdayPolicy={matchdayPolicy}><main className={`fans fans-workspace ${parents.length ? 'fans-managed' : 'fans-standalone'}`}>
    <FanClubBrand source={brandSource} matchdayPolicy={matchdayPolicy} />
    <header className="fans-heading"><div><span className="fans-eyebrow">{parents.length ? 'Sharing with family' : 'Your football'}</span><h1>{section === 'settings' ? 'Settings' : parents.length ? 'Fans' : 'Players'}</h1><p>{section === 'settings' ? 'Manage your connections and account.' : parents.length ? 'Choose who follows your player and what they can see.' : 'Follow your players, their matches and shared updates.'}</p></div></header>
    <UserFeedbackLinks />
    <nav className="fans-navigation" aria-label="Fan navigation"><button aria-current={section === 'players' ? 'page' : undefined} onClick={() => navigate('players')}><FanIcon />{parents.length ? 'Fans' : 'Players'}</button><button aria-current={section === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}>Settings</button>{parents.length ? <Link to="/parent-portal">Parent portal</Link> : null}</nav>
    {state.error ? <p role="alert" className="fans-error">{state.error}</p> : null}
    {state.loading ? <p role="status">Loading Fans...</p> : null}
    {section === 'players' && !state.view && parents.length ? <section className="fans-owner-panel">
      <label>Player<select aria-label="Player" disabled={busy} value={selectedParent?.id || ''} onChange={(e) => { setParentId(e.target.value); state.clearView(); setForm(null); setReady(null); setQr('') }}>{parents.map((p) => <option value={p.id} key={p.id}>{p.playerName}</option>)}</select></label>
      <button className="fans-action fans-invite" disabled={busy} onClick={() => begin()}><FanIcon name="invite" />Invite a Fan</button>
      {form ? <form onSubmit={(e) => { e.preventDefault(); confirm('email') }}>
        <label>Name<input autoComplete="name" required maxLength={120} disabled={Boolean(form.id)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Email<input autoComplete="email" type="email" required maxLength={254} disabled={Boolean(form.id)} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <fieldset><legend>Choose access</legend>{ownerAccess.map((item) => <label className="fans-permission" key={item.key}><FanIcon name={item.key} /><span><strong>{item.label}</strong><small>{item.description}</small></span><input type="checkbox" checked={form.permissions[item.key]} disabled={item.key === 'resources' && !form.permissions.development} onChange={(e) => setForm({ ...form, permissions: normalizeFanPermissions({ ...form.permissions, [item.key]: e.target.checked }) })} /></label>)}</fieldset>
        <div className="fans-actions">{form.id ? <button disabled={busy} type="submit">Review changes</button> : <><button type="submit" disabled={busy}><FanIcon name="email" />Email</button><button type="button" disabled={busy} onClick={() => confirm('qr')}><FanIcon name="qr" />QR code</button><button type="button" disabled={busy} onClick={() => confirm('share')}><FanIcon name="share" />Share link</button></>}<button type="button" onClick={() => setForm(null)}>Cancel</button></div>
      </form> : null}
      {ready ? <div className="fans-ready"><p>Invitation ready for <strong>{ready.name}</strong> ({ready.email}). Expires {formatParentProductDateTime(ready.expires_at, { year: 'numeric' })}.</p>{qr ? <img src={qr} width="300" height="300" alt={`Invitation QR code for ${ready.name}`} /> : null}<div className="fans-actions"><button onClick={() => run(async () => { await navigator.clipboard.writeText(ready.url) })}>Copy link</button><button onClick={() => run(() => fanRequest({ action: 'send_invitation', connectionId: ready.id }))}>Send email</button></div></div> : null}
      <h2>Your player's Fans</h2>
      {state.connections.filter((c) => c.is_owner && c.parent_link_id === selectedParent?.id).map((c) => <div className="fans-person" key={c.id}><FanIcon /><div><strong>{c.name}</strong><small>{c.email}</small><small>{c.status} · {FAN_ACCESS.filter((p) => c.permissions[p.key]).map((p) => p.label).join(', ')}</small></div>{['pending', 'active'].includes(c.status) ? <div className="fans-actions"><button onClick={() => begin(c)}>Edit access</button><button onClick={() => setConfirmation({ remove: c, child: selectedParent.playerName })}>{c.status === 'pending' ? 'Cancel invitation' : 'Revoke access'}</button></div> : null}{c.status === 'cancelled' ? <button disabled={busy} onClick={() => setConfirmation({ deleteInvitation: c })}><FanIcon name="remove" />Delete</button> : null}</div>)}
      {!state.connections.some((c) => c.is_owner && c.parent_link_id === selectedParent?.id) ? <p>No Fans invited for this player yet.</p> : null}
    </section> : null}
    {section === 'players' && !state.view ? <section className="fans-players" aria-label="Players you follow">{parents.length ? <h2>Players you follow</h2> : null}
      {!state.loading && !followed.length ? <div className="fans-empty"><FanIcon /><h2>No players to follow yet</h2><p>When a parent invites you, accept their invitation using this account to see the player here.</p></div> : null}
      <div className="fans-player-grid">{followed.map((c) => <FanBrandScope source={c} key={c.id} matchdayPolicy={matchdayPolicy}><article className="fans-following"><FanClubBrand source={c} matchdayPolicy={matchdayPolicy} /><div className="fans-player-identity"><span className="fans-player-avatar"><FanIcon /></span><div><h2>{c.player_name}</h2><small>{c.team_name}</small></div></div>
        <div className="fans-feature-grid">{getFanAccessForPlan(c, matchdayPolicy).filter((p) => c.permissions[p.key]).map((p) => <button key={p.key} onClick={() => openFanSection(c, p.key === 'game_day' ? 'matches' : p.key)}><FanIcon name={p.key} /><span>{p.key === 'resources' ? 'Resources' : p.label}</span><span aria-hidden="true" className="fans-chevron">›</span></button>)}</div>
        {c.permissions.game_day && isFanAccessAllowedForPlan(c, 'notifications', matchdayPolicy) ? <div className="fans-notifications"><button onClick={() => openFanSection(c, 'notifications')}>View notifications <span aria-hidden="true">›</span></button><label><span>Game Day notifications</span><input aria-label={`Game Day notifications for ${c.player_name}`} role="switch" type="checkbox" disabled={busy} checked={Boolean(c.notifications_enabled)} onChange={(e) => run(() => state.manage(c.id, e.target.checked ? 'notifications_on' : 'notifications_off'))} /></label></div> : null}
      </article></FanBrandScope>)}</div>
    </section> : null}
    {section === 'settings' ? <section className="fans-settings"><h2>Linked players</h2><p>Removing a connection ends your access to that player. Your account and other connections stay available.</p>{followed.length ? followed.map((c) => <div className="fans-setting-row" key={c.id}><div><strong>{c.player_name}</strong><small>{c.club_name} · {c.team_name}</small></div><button className="fans-remove-icon" title={`Remove my access to ${c.player_name}`} aria-label={`Remove my access to ${c.player_name}`} disabled={busy} onClick={() => setConfirmation({ selfRemove: c })}><FanIcon name="remove" /></button></div>) : <p>No Fan connections to manage.</p>}<div className="fans-account"><h2>Account</h2><p>{user?.email}</p><button disabled={busy} onClick={() => setConfirmation({ signOut: true })}>Sign out</button></div></section> : null}
    {state.view ? <FanContent key={`${state.view.connectionId}:${state.view.action}`} state={state} run={run} /> : null}
    <ConfirmModal isOpen={Boolean(confirmation)} isBusy={busy} title={confirmation?.signOut ? 'Sign out?' : confirmation?.deleteInvitation ? 'Delete cancelled invitation?' : confirmation?.selfRemove ? 'Remove my access' : confirmation?.remove ? 'End Fan access' : 'Confirm Fan access'} cancelLabel="Go back" confirmLabel={confirmation?.signOut ? 'Sign out' : confirmation?.deleteInvitation ? 'Delete' : confirmation?.remove || confirmation?.selfRemove ? 'Remove access' : confirmation?.id ? 'Confirm changes' : 'Confirm invitation'} onCancel={() => setConfirmation(null)} onConfirm={() => confirmation?.signOut ? run(async () => { await signOut(); setConfirmation(null) }) : confirmation?.deleteInvitation ? run(async () => { await state.deleteInvitation(confirmation.deleteInvitation.id); setConfirmation(null) }) : confirmation?.remove || confirmation?.selfRemove ? run(async () => { const c = confirmation.remove || confirmation.selfRemove; await state.manage(c.id, confirmation.selfRemove ? 'remove' : 'revoke'); setConfirmation(null) }) : complete()}>
      {confirmation?.signOut ? <p>You will need to sign in again to view your players and shared updates.</p> : confirmation?.deleteInvitation ? <p>Remove the cancelled invitation for <strong>{confirmation.deleteInvitation.name} ({confirmation.deleteInvitation.email})</strong> from your Fans list?</p> : confirmation?.remove || confirmation?.selfRemove ? <p>Access to <strong>{confirmation.selfRemove?.player_name || confirmation.child || 'this player'}</strong> and associated notifications will end. A new invitation will be needed to restore access.</p> : confirmation ? <><p>{confirmation.id ? 'You are updating access for' : 'You are inviting'} <strong>{confirmation.name} ({confirmation.email})</strong> to follow <strong>{confirmation.child}</strong>.</p><ul>{fanAccessSummary(confirmation.permissions).map((line) => <li key={line}>{line}</li>)}</ul><p>This person cannot invite others, use parent chat, respond to attendance or change your player's information. Either of you can end this access.</p></> : null}
    </ConfirmModal>
  </main></FanBrandScope>
}
function FanContent({ state, run }) {
  const data = state.content
  const connection = state.connections.find((item) => item.id === state.view.connectionId)
  const title = { schedule: 'Schedule', matches: 'Game Day', development: 'Development records', resources: 'Resources', notifications: 'Notifications' }[state.view.action] || 'Shared updates'
  const [resource, setResource] = useState(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const openResource = (item) => run(async () => {
    const result = await fanRequest({ action: 'open_resource', connectionId: state.view.connectionId, resourceId: item.id })
    if (active.current) setResource({ ...result, title: item.title, id: item.id })
  })
  const board = resource?.formationBoard
  return <section className="fans-content"><button className="fans-back" onClick={state.clearView}>Back to players</button><header className="fans-content-heading"><small>{connection?.player_name}{connection?.team_name ? ` · ${connection.team_name}` : ''}</small><h2>{title}</h2><p>{state.view.action === 'matches' ? 'Fixtures and match updates shared through Game Day access.' : 'Updates shared with you by this player’s parent.'}</p></header>{state.contentError ? <div><p role="alert">{state.contentError}</p><button onClick={() => state.open(state.view.connectionId, state.view.action, state.view.matchId ? { matchId: state.view.matchId } : {})}>Try again</button></div> : !data ? <p role="status">Loading...</p> : <>
    {(data.matches || []).map((m) => <button className="fans-person" key={m.id} onClick={() => state.open(state.view.connectionId, 'matches', { matchId: m.id })}><FanIcon name="game_day" /><span><strong>{m.home_away === 'away' ? `${m.opponent} v ${m.club_name || connection?.club_name || 'Our club'}` : `${m.club_name || connection?.club_name || 'Our club'} v ${m.opponent}`}</strong>{m.home_score != null && m.away_score != null ? <span className="fans-score">{m.home_score} : {m.away_score}</span> : null}<small>{formatParentProductDateTime(m.match_date, { year: 'numeric' })} · {m.kickoff_time_tbc ? 'Time TBC' : formatParentProductTime(m.kickoff_time)} · {m.status}</small></span></button>)}
    {(data.events || []).map((e) => <p key={e.id}>{e.minute == null ? '' : `${e.minute} min · `}{e.event_type.replaceAll('_', ' ')} · {e.home_score} : {e.away_score}</p>)}
    {upcomingFanSchedule(data.schedule || []).map((e) => <div className="fans-person" key={e.id}><FanIcon name="schedule" /><div><strong>{e.title}</strong><small>{formatParentProductDateTime(e.starts_at || (e.time ? `${e.date}T${e.time}` : e.date), { year: 'numeric' })}</small><small>{e.location}{e.recurrence_frequency && e.recurrence_frequency !== 'none' ? ` · Repeats ${e.recurrence_frequency}${e.recurrence_until ? ` until ${formatParentProductDateTime(e.recurrence_until, { year: 'numeric' })}` : ''}` : ''}</small></div></div>)}
    {(data.notifications || []).map((n) => <article className="fans-update" key={n.id}><strong>{n.title}</strong><p>{n.body}</p></article>)}
    {(data.reports || []).map((r) => <details key={r.id}><summary>{r.form?.name || 'Development report'} · {formatParentProductDateTime(r.recordDate, { year: 'numeric' })}</summary><p>{r.overallScore == null ? '' : `Overall ${r.overallScore} / ${r.overallMaxScore}`}</p>{r.responseItems?.map((item, i) => <p key={i}><strong>{item.label || item.question}</strong> {item.displayValue || item.value || item.answer || item.score}</p>)}{r.sections?.map((s, i) => <div key={i}><strong>{s.title}</strong><p>{s.body || s.text}</p>{s.chartPoints?.map((point, n) => <p key={n}>{point.label}: {point.value}</p>)}</div>)}</details>)}
    {(data.resources || []).map((r) => <button className="fans-person" key={r.id} onClick={() => openResource(r)}><FanIcon name="resources" /><span>{r.title}</span></button>)}
    {resource && data.resources?.some((r) => r.id === resource.id) ? <div>
      <h3>{resource.title}</h3><button onClick={() => setResource(null)}>Close resource</button>
      {board ? <><p>{board.description}</p><FormationBoardPitch canEdit={false} hasPlacementSource={false} placements={board.placements || []} /><h4>Bench</h4>{(board.bench || []).map((p) => <p key={p.playerId}>{p.displayName || p.playerName}</p>)}<p>{board.notes}</p></> : /^https:\/\//.test(resource.accessUrl || '') ? <a href={resource.accessUrl} target="_blank" rel="noopener noreferrer">Open {resource.title}</a> : <p>This resource could not be opened.</p>}
    </div> : null}
    {!Object.values(data).some((v) => Array.isArray(v) && v.length) ? <p>No shared items are available.</p> : null}
  </>}</section>
}
