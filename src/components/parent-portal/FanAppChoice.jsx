import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { fanAppHandoffLinks, PARENT_APP_STORE_URL, PARENT_PLAY_STORE_URL } from '../../lib/fan-app-handoff.js'

export function FanAppChoice({ token, accepted = false, playerName = '', onContinueWeb }) {
  const links = fanAppHandoffLinks(token, { accepted })
  const [codes, setCodes] = useState({})
  const [copyMessage, setCopyMessage] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([PARENT_APP_STORE_URL, PARENT_PLAY_STORE_URL].map(url => QRCode.toDataURL(url, { margin: 4, width: 220 })))
      .then(([apple, android]) => { if (active) setCodes({ apple, android }) })
      .catch(() => { if (active) setCodes({}) })
    return () => { active = false }
  }, [])
  if (!links) return <p role="alert">This invitation link is invalid. Open the original invitation again.</p>
  return <section className="fan-app-choice" aria-label="Choose how to open your Fan invitation">
    <h2>{accepted ? 'Your Fan access is ready' : 'Choose how to continue'}</h2>
    {playerName ? <p>{accepted ? 'You can now follow' : 'You have been invited to follow'} <strong>{playerName}</strong>.</p> : null}
    <p>Fans use the Football Player Parent app. Choose the app or continue on this website.</p>
    <a className="fan-app-primary" href={links.app}>Open Parent app</a>
    <p className="fan-app-hint">If the app does not open, install it below, then return to this invitation and tap Open Parent app. Sign in using the email address that was invited.</p>
    <div className="fan-app-downloads">
      {[['apple', 'Download on the App Store', 'iPhone'], ['android', 'Get it on Google Play', 'Android']].map(([key, label, platform]) => <div className="fan-app-download" key={key}>
        <a href={links[key]} target="_blank" rel="noreferrer">{label}</a>
        {codes[key] ? <img src={codes[key]} width="180" height="180" alt={`Scan to download the Parent app for ${platform}`} /> : null}
      </div>)}
    </div>
    {!accepted ? <details className="fan-app-save"><summary>Keep this invitation for after installing</summary><p>The download links install the app. Your invitation stays in your email and on this page.</p><a href={links.invitation}>Your invitation link</a><button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(links.invitation); setCopyMessage('Invitation link copied.') }
      catch { setCopyMessage('Copy the invitation link above, or reopen your original invitation email.') }
    }}>Copy invitation link</button>{copyMessage ? <p role="status">{copyMessage}</p> : null}</details> : null}
    <button type="button" className="fan-app-web" onClick={onContinueWeb}>{accepted ? 'Continue on website' : 'Sign in or continue on website'}</button>
  </section>
}
