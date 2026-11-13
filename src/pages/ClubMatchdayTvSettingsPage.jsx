import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { clubTvSlugStatus, clubTvStorageKey, clubTvViewerUrl, hasLocalTvPreferences, normalizeClubTvSlug, normalizeTvPreferences, readTvPreferences, TV_SPONSOR_EXTENSIONS, TV_SPONSOR_MAX_BYTES, validTvSponsorSchedule } from '../lib/club-matchday-tv.js'
import { getClubMatchdayTv, uploadClubTvSponsor } from '../lib/domain/club-matchday-tv.js'
import { ClubTvSponsorImage } from '../components/ClubTvSponsorImage.jsx'
import './club-matchday-tv.css'
import './club-matchday-tv-settings.css'

const availabilityMessages = {
  available: 'Available',
  taken: 'Already taken',
  reserved: 'Reserved',
  invalid: 'Use at least four letters. Numbers and single hyphens are also allowed.',
  checking: 'Checking availability…',
  unavailable: 'Availability could not be checked. Try again to save this ending.',
}

async function prepareTvArtwork(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const decoded = new Image()
  decoded.src = data
  await decoded.decode()
  if (!decoded.width || !decoded.height || decoded.width > 12000 || decoded.height > 12000) throw new Error('Invalid image dimensions')
  let scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height))
  const canvas = document.createElement('canvas')
  let image
  do {
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    canvas.getContext('2d').drawImage(decoded, 0, 0, canvas.width, canvas.height)
    image = canvas.toDataURL('image/webp', 0.88)
    scale *= 0.75
  } while (image.length >= 700000 && scale > 0.01)
  if (!image.startsWith('data:image/webp;base64,') || image.length >= 700000) throw new Error('Image cannot be saved')
  return image
}

function DisplaySettings({ clubId, settings, storageKey }) {
  const [hasLegacySettings] = useState(() => hasLocalTvPreferences(storageKey))
  const [usesLegacySettings, setUsesLegacySettings] = useState(hasLegacySettings && !settings.preferences)
  const [draft, setDraft] = useState(() => settings.preferences
    ? normalizeTvPreferences(settings.preferences) : { ...readTvPreferences(storageKey), accessMode: 'admin' })
  const [savedSlug, setSavedSlug] = useState(settings.slug || '')
  const [revision, setRevision] = useState(settings.revision)
  const [slug, setSlug] = useState(savedSlug)
  const [checked, setChecked] = useState(null)
  const [checkAttempt, setCheckAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dragTarget, setDragTarget] = useState('')
  const [mapUploading, setMapUploading] = useState(false)
  const [sponsorsUploading, setSponsorsUploading] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(null)
  const uploadVersion = useRef(0)
  const sponsorPreviews = useRef(new Set())

  useEffect(() => {
    const previews = sponsorPreviews.current
    return () => { for (const url of previews) URL.revokeObjectURL(url) }
  }, [])
  const slugStatus = clubTvSlugStatus(slug)
  const availability = slugStatus !== 'valid' ? slugStatus
    : slug === savedSlug ? 'available' : checked?.slug === slug ? checked.status : 'checking'
  const needsLink = draft.accessMode === 'public' && !slug && !savedSlug
  const canSave = !saving && !mapUploading && !sponsorsUploading && !needsLink && (!slug || availability === 'available')
  const link = savedSlug ? clubTvViewerUrl(savedSlug) : ''

  useEffect(() => {
    if (slugStatus !== 'valid' || slug === savedSlug) return undefined
    const controller = new AbortController()
    let timeout
    const timer = setTimeout(async () => {
      timeout = setTimeout(() => {
        controller.abort()
        setChecked({ slug, status: 'unavailable' })
      }, 10000)
      try {
        const result = await getClubMatchdayTv({ clubId, action: 'availability', slug, signal: controller.signal })
        if (!controller.signal.aborted) setChecked({ slug, status: result.availability })
      } catch {
        if (!controller.signal.aborted) setChecked({ slug, status: 'unavailable' })
      } finally {
        clearTimeout(timeout)
      }
    }, 300)
    return () => { clearTimeout(timer); clearTimeout(timeout); controller.abort() }
  }, [checkAttempt, clubId, savedSlug, slug, slugStatus])

  function changeSlug(event) {
    const nextSlug = normalizeClubTvSlug(event.target.value)
    if (nextSlug === slug) return
    setSlug(nextSlug)
    setChecked(null)
    setError('')
    setMessage('')
  }

  async function upload(file) {
    const version = ++uploadVersion.current
    if (!file) { setMapUploading(false); return }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setMapUploading(false); setError('Choose a PNG, JPG or WebP image up to 5 MB.'); return }
    setMapUploading(true)
    try {
      const data = await prepareTvArtwork(file)
      if (version === uploadVersion.current) { setDraft((current) => ({ ...current, map: data, showMap: true })); setError('') }
    } catch { if (version === uploadVersion.current) setError('This image could not be opened. Try a smaller PNG, JPG or WebP.') }
    finally { if (version === uploadVersion.current) setMapUploading(false) }
  }
  async function uploadSponsors(files) {
    if (sponsorsUploading) return
    const incoming = [...files].slice(0, Math.max(0, 3 - draft.sponsorAds.length))
    if (!incoming.length) return
    if (incoming.some(file => !Object.hasOwn(TV_SPONSOR_EXTENSIONS, file.type) || !file.size || file.size > TV_SPONSOR_MAX_BYTES)) {
      setError('Each sponsor image must be PNG, JPG or WebP and up to 5 MB.')
      return
    }
    setSponsorsUploading(true)
    try {
      for (const file of incoming) {
        const image = URL.createObjectURL(file)
        sponsorPreviews.current.add(image)
        try {
          const decoded = new Image()
          decoded.src = image
          await decoded.decode()
          if (!decoded.width || !decoded.height || decoded.width > 12000 || decoded.height > 12000) throw new Error('Invalid image dimensions')
          const imagePath = await uploadClubTvSponsor(clubId, file)
          const ad = { image, imagePath, name: '', enabled: true, startDate: '', endDate: '' }
          setDraft(current => ({ ...current, sponsorAds: [...current.sponsorAds, ad].slice(0, 3) }))
        } catch (failure) {
          URL.revokeObjectURL(image)
          sponsorPreviews.current.delete(image)
          throw failure
        }
      }
      setError('')
    } catch { setError('The sponsor images could not be opened. Try another PNG, JPG or WebP.') }
    finally { setSponsorsUploading(false) }
  }
  function dropFiles(event, target) {
    event.preventDefault()
    setDragTarget('')
    if (saving) return
    if (target === 'map') void upload(event.dataTransfer.files?.[0])
    else void uploadSponsors(event.dataTransfer.files || [])
  }
  function updateSponsor(index, change) {
    setDraft(current => ({ ...current, sponsorAds: current.sponsorAds.map((ad, itemIndex) => itemIndex === index ? { ...ad, ...change } : ad) }))
  }
  function moveSponsor(index, direction) {
    setDraft(current => {
      const ads = [...current.sponsorAds], target = index + direction
      if (target < 0 || target >= ads.length) return current
      const currentAd = ads[index]
      ads[index] = ads[target]
      ads[target] = currentAd
      return { ...current, sponsorAds: ads }
    })
    setPreviewIndex(null)
  }
  async function save(event) {
    event.preventDefault()
    if (!canSave) return
    if (!draft.sponsorAds.every(validTvSponsorSchedule)) {
      setError('Each advert end date must be on or after its start date.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await getClubMatchdayTv({ clubId, action: 'save', slug: slug || null, preferences: normalizeTvPreferences(draft), revision })
      const preferences = normalizeTvPreferences(result.settings.preferences)
      if (usesLegacySettings) {
        try { localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch { /* The shared settings are saved. */ }
      }
      setDraft(preferences)
      setRevision(result.settings.revision)
      setSavedSlug(slug || savedSlug)
      setSlug(slug || savedSlug)
      setMessage('Display settings saved.')
    } catch (failure) {
      if (failure.availability) setChecked({ slug, status: failure.availability })
      setError(failure.message)
    } finally { setSaving(false) }
  }
  return <>
    <div className="club-tv-admin-actions">
      <Link to="/club-matchday-tv?preview=1">Preview saved display</Link>
    </div>
    {link ? <ViewingLink id="club-tv-saved-link" label="Saved viewing link" url={link} copyLabel="Copy viewing link" /> : null}
    <form onSubmit={save}>
      <fieldset disabled={saving}>
        <legend>Display settings</legend>
        {hasLegacySettings ? <p>{usesLegacySettings
          ? 'This browser’s existing settings are ready to save for the club.'
          : <button type="button" onClick={() => { setDraft({ ...readTvPreferences(storageKey), accessMode: draft.accessMode }); setPreviewIndex(null); setUsesLegacySettings(true) }}>Use this browser’s previous settings</button>}</p> : null}
        <label>Club link ending <input value={slug} maxLength={63} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="e.g. ctfc" aria-describedby="club-tv-slug-help club-tv-slug-status" onChange={changeSlug} /></label>
        <small id="club-tv-slug-help">Use at least four letters.</small>
        {slug && slug !== savedSlug && slugStatus === 'valid' ? <ViewingLink id="club-tv-draft-link" label="Full viewing link" url={clubTvViewerUrl(slug)}
          copyLabel="Copy link preview" disabled={availability !== 'available'} pending /> : null}
        <small id="club-tv-slug-status" role="status">{slug ? availabilityMessages[availability] : ''}</small>
        {availability === 'unavailable' ? <button type="button" onClick={() => { setChecked(null); setCheckAttempt(attempt => attempt + 1) }}>Check availability again</button> : null}
        <label>Viewing access <select aria-describedby="club-tv-access-help" value={draft.accessMode} onChange={(event) => setDraft({ ...draft, accessMode: event.target.value })}>
          <option value="admin">Club Admin sign-in</option>
          <option value="public">Public</option>
        </select></label>
        <small id="club-tv-access-help">{needsLink ? 'Choose a link ending to make the display public.' : draft.accessMode === 'public'
          ? 'Anyone with the link can see your club’s fixtures, live scores and display artwork after you save.'
          : 'An active Club Admin for your club must sign in on the viewing browser.'}</small>
        <label>Appearance <select aria-label="Appearance" value={draft.appearance} onChange={(event) => setDraft({ ...draft, appearance: event.target.value })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Club ground postcode <input value={draft.weatherPostcode} maxLength={10} placeholder="e.g. CB23 6FY" onChange={(event) => setDraft({ ...draft, weatherPostcode: event.target.value.toUpperCase() })} /></label>
        <small>Weather uses this ground, wherever the screen is running. Great Britain postcodes supported.</small>
        <label className="club-tv-check"><input type="checkbox" checked={draft.bigGoal} onChange={(event) => setDraft({ ...draft, bigGoal: event.target.checked })} /> Large goal celebration</label>
        <small>Switch off for a small goal popup. All celebrations are silent.</small>
        <label className={`club-tv-upload${dragTarget === 'map' ? ' club-tv-upload-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragTarget('map') }} onDragLeave={() => setDragTarget('')} onDrop={(event) => dropFiles(event, 'map')}>Pitch map <span>Drag and drop or click to upload</span><input aria-label="Pitch map" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} /></label>
        <small>PNG, JPG or WebP, up to 5 MB. The map stays beside the rotating scores.</small>
        {draft.map ? <><img className="club-tv-map-preview" src={draft.map} alt="Uploaded pitch map preview" /><label className="club-tv-check"><input type="checkbox" checked={draft.showMap} onChange={(event) => setDraft({ ...draft, showMap: event.target.checked })} /> Show map on half the display</label><button type="button" onClick={() => { uploadVersion.current++; setMapUploading(false); setDraft({ ...draft, map: '' }) }}>Remove map</button></> : null}
        <label className={`club-tv-upload${dragTarget === 'sponsor' ? ' club-tv-upload-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragTarget('sponsor') }} onDragLeave={() => setDragTarget('')} onDrop={(event) => dropFiles(event, 'sponsor')}>Sponsor artwork <span>Drag and drop or click to upload</span><input aria-label="Sponsor artwork" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={sponsorsUploading} onChange={(event) => { void uploadSponsors(event.target.files || []); event.target.value = '' }} /></label>
        <small>Add up to three adverts, up to 5 MB each. New sponsor images are saved at their original quality.</small>
        {draft.sponsorAds.length ? <label>Time per advert <select aria-label="Time per advert" value={draft.sponsorSeconds} onChange={(event) => setDraft({ ...draft, sponsorSeconds: Number(event.target.value) })}>{[10, 15, 30, 60].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label> : null}
        {draft.sponsorAds.map((ad, index) => <div className="club-tv-sponsor-settings" key={index}>
          <div className="club-tv-sponsor-edit"><ClubTvSponsorImage ad={ad} clubId={clubId} alt={`Sponsor ${index + 1} preview`} /><strong>Advert {index + 1}</strong><button type="button" onClick={() => setPreviewIndex(previewIndex === index ? null : index)} aria-label={`Preview sponsor ${index + 1}`}>Preview</button><button type="button" aria-label={`Move sponsor ${index + 1} up`} disabled={index === 0} onClick={() => moveSponsor(index, -1)}>↑</button><button type="button" aria-label={`Move sponsor ${index + 1} down`} disabled={index === draft.sponsorAds.length - 1} onClick={() => moveSponsor(index, 1)}>↓</button><button type="button" aria-label={`Remove sponsor ${index + 1}`} onClick={() => { setPreviewIndex(null); setDraft(current => ({ ...current, sponsorAds: current.sponsorAds.filter((_, itemIndex) => itemIndex !== index) })) }}>Remove</button></div>
          {previewIndex === index ? <div className="club-tv-ad-preview"><ClubTvSponsorImage ad={ad} clubId={clubId} alt={`Full preview of sponsor ${index + 1}`} /></div> : null}
          <label className="club-tv-check"><input type="checkbox" checked={ad.enabled !== false} onChange={(event) => updateSponsor(index, { enabled: event.target.checked })} /> Show advert {index + 1}</label>
          <div className="club-tv-sponsor-dates"><label>Start date (optional)<input aria-label={`Sponsor ${index + 1} start date`} type="date" value={ad.startDate || ''} onChange={(event) => updateSponsor(index, { startDate: event.target.value })} /></label><label>End date (optional)<input aria-label={`Sponsor ${index + 1} end date`} type="date" value={ad.endDate || ''} onChange={(event) => updateSponsor(index, { endDate: event.target.value })} /></label></div>
        </div>)}
        {draft.sponsorAds.length ? <small>Dates use UK time and include the whole start and end days. Leave them blank to show an advert at any time.</small> : null}
        <label className="club-tv-check"><input type="checkbox" checked={draft.showPitchsideOrdering} onChange={(event) => setDraft({ ...draft, showPitchsideOrdering: event.target.checked })} /> Show pitchside ordering</label>
        <small>When enabled, the display says Coming soon until ordering is available.</small>
        {error ? <p role="alert">{error}</p> : null}
        <p role="status">{message}</p>
        <div className="club-tv-admin-actions"><button type="submit" disabled={!canSave}>{saving ? 'Saving…' : 'Save settings'}</button></div>
        <small>Forecast: <a href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a>, CC BY 4.0. Postcodes: <a href="https://postcodes.io/docs/licences/" target="_blank" rel="noreferrer">OS OpenData and ONS</a>. Contains OS data and National Statistics data © Crown copyright and database right {new Date().getFullYear()}. Contains Royal Mail data © Royal Mail copyright and database right {new Date().getFullYear()}.</small>
      </fieldset>
    </form>
  </>
}

function ViewingLink({ id, label, url, copyLabel, disabled = false, pending = false }) {
  const input = useRef(null)
  const [copied, setCopied] = useState(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied({ url, message: pending ? 'Link copied. Save settings to activate it.' : 'Viewing link copied.' })
    } catch {
      input.current?.focus()
      setCopied({ url, message: 'Link selected. Use your device’s copy command.' })
    }
  }

  return <div>
    <label htmlFor={id}>{label}</label>
    <div className="club-tv-link-row">
      <input id={id} ref={input} value={url} readOnly onFocus={(event) => event.target.select()} />
      <button type="button" disabled={disabled} onClick={copy}>{copyLabel}</button>
    </div>
    {copied?.url === url ? <small role="status">{copied.message}</small> : null}
  </div>
}

export function ClubMatchdayTvSettingsPage() {
  const { user } = useAuth()
  return <ClubTvSettings key={clubTvStorageKey(user)} user={user} />
}

function ClubTvSettings({ user }) {
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const storageKey = clubTvStorageKey(user)

  useEffect(() => {
    const controller = new AbortController()
    getClubMatchdayTv({ clubId: user.clubId, action: 'settings', signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setSettings(result.settings) })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [attempt, user.clubId])

  return <section className="club-tv-admin" aria-labelledby="club-tv-settings-title">
    <h1 id="club-tv-settings-title">Matchday TV</h1>
    {error ? <p role="alert">{error} <button onClick={() => { setError(''); setAttempt(attempt + 1) }}>Try again</button></p> : null}
    {settings ? <DisplaySettings clubId={user.clubId} settings={settings} storageKey={storageKey} /> : !error ? <p role="status">Loading display settings…</p> : null}
  </section>
}
