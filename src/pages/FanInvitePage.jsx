import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { supabase } from '../lib/supabase-client.js'
import { fanRpc } from '../lib/fans-client.js'
import { fanAccessSummary } from '../lib/fans.js'
import { FanIcon } from '../components/parent-portal/FanIcon.jsx'
import './fans.css'
export function FanInvitePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setInvite(null)
    if (session?.user) fanRpc('get_fan_invitation', { token_value: token }).then((row) => { if (active) setInvite(row) }).catch((e) => { if (active) setMessage(e.message) })
    return () => { active = false }
  }, [session?.user, token])
  const run = async (action) => { setBusy(true); setMessage(''); try { await action() } catch (e) { setMessage(e.message) } finally { setBusy(false) } }
  return <main className="fans"><header className="fans-heading"><FanIcon /><h1>Your Fan invitation</h1></header><p>Sign in with the email address the Parent invited. You will only receive the access they selected.</p>
    {message ? <p role="status">{message}</p> : null}
    {!session?.user ? <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; setPassword('') }) }}>
      <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <div className="fans-actions"><button disabled={busy} type="submit">Sign in</button><button disabled={busy} type="button" onClick={() => run(async () => { const response = await fetch('/.netlify/functions/create-fan-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, email, password }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setMessage(result.message); setPassword('') })}>Create account</button><Link to="/parent-login">Forgot password?</Link></div>
    </form> : <><p>Signed in as {session.user.email}</p><button onClick={() => run(() => supabase.auth.signOut())}>Use a different account</button>{invite ? <><h2>Follow {invite.player_name}</h2><ul>{fanAccessSummary(invite.permissions).map((line) => <li key={line}>{line}</li>)}</ul><p>You cannot invite other people or change this child's information. You can remove your own access at any time.</p><button disabled={busy} onClick={() => run(async () => { await fanRpc('accept_fan_invitation', { token_value: token }); navigate('/fans', { replace: true }); window.location.reload() })}>Accept invitation</button></> : null}</>}
  </main>
}
