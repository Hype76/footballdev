import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase-client.js'
import { canManageClubSettings } from '../../lib/auth-permissions.js'
import { blockDemoMutation } from '../../lib/domain/demo-guards.js'
import { KIT_TYPES, kitLabel, normalizeClubKit, readClubKits } from '../../lib/club-kits.js'
import { KitArtwork } from './ClubKitDisplay.jsx'

const inputClass = 'rounded border border-[var(--border-color,#b8c7c0)] bg-transparent p-2'
const buttonClass = 'min-h-11 rounded border border-[var(--border-color,#b8c7c0)] px-3 py-2 font-bold disabled:opacity-50'
async function loadImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file?.type)) throw new Error('Choose a PNG, JPG or WebP image.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.width || !image.height || image.width * image.height > 40000000) throw new Error('Choose an image under 40 megapixels.')
    return image
  } finally { URL.revokeObjectURL(url) }
}
function paintKitImage(canvas, image, transform) {
  const ctx = canvas.getContext('2d')
  const size = canvas.width
  ctx.clearRect(0, 0, size, size)
  const scale = Math.min(size / image.width, size / image.height) * transform.zoom
  const width = image.width * scale, height = image.height * scale
  ctx.drawImage(image, (size - width) / 2 + transform.x * size / 2, (size - height) / 2 + transform.y * size / 2, width, height)
}
export function ClubKitsSection({ user }) {
  const [kits, setKits] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    readClubKits(supabase, user.clubId).then(value => { if (active) { setKits(value); setLoading(false) } }).catch(() => { if (active) setError('Kits could not be loaded. Reload this page to try again.') })
    return () => { active = false }
  }, [user.clubId])
  if (!canManageClubSettings(user)) return null
  return <section className="space-y-4 border-t border-[var(--border-color,#b8c7c0)] pt-5" aria-label="Club kits">
    <h2 className="text-xl font-black">Kits</h2>
    <p>Set the Home and Away kits shown to coaches and parents. The kit selected for each fixture decides which one is displayed.</p>
    {error ? <p role="alert">{error}</p> : loading ? <p>Loading kits...</p> : <div className="grid gap-8 sm:grid-cols-2">{KIT_TYPES.map(type => <KitEditor key={`${user.clubId}:${type}`} user={user} type={type} savedKit={kits[type]} onSaved={kit => setKits(value => ({ ...value, [type]: kit }))} />)}</div>}
  </section>
}
export function KitEditor({ user, type, savedKit, onSaved }) {
  const [kit, setKit] = useState(savedKit || normalizeClubKit())
  const [picker, setPicker] = useState(false)
  const [pending, setPending] = useState(null)
  const [reference, setReference] = useState(null)
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const canvas = useRef(null), sampleCanvas = useRef(null), upload = useRef(null)
  const label = kitLabel(type), hasImage = Boolean(pending || kit.imagePath)
  useEffect(() => { if (pending && canvas.current) paintKitImage(canvas.current, pending, transform) }, [pending, transform])
  useEffect(() => { if (reference && sampleCanvas.current) paintKitImage(sampleCanvas.current, reference, { zoom: 1, x: 0, y: 0 }) }, [reference])
  const chooseFile = async (file, sample = false) => {
    if (!file || busy) return
    setError(''); setMessage('')
    try {
      const image = await loadImage(file)
      if (sample) setReference(image)
      else { setPending(image); setTransform({ zoom: 1, x: 0, y: 0 }); setPicker(false) }
    } catch (failure) { setError(failure.message) }
  }
  const eyedropper = async () => {
    try { const result = await new window.EyeDropper().open(); setKit(value => ({ ...value, colour: result.sRGBHex })) }
    catch (failure) { if (failure.name !== 'AbortError') setError('The screen colour picker could not open. Use the colour picker or sample an uploaded image.') }
  }
  const save = async () => {
    setBusy(true); setError(''); setMessage('')
    let uploadedPath = ''
    try {
      await blockDemoMutation(user)
      if (!canManageClubSettings(user)) throw new Error('Only Club Admins can change kits.')
      let imagePath = kit.imagePath
      if (pending) {
        const blob = await new Promise(resolve => canvas.current.toBlob(resolve, 'image/png'))
        if (!blob || blob.size > 2097152) throw new Error('The cropped image is too large. Try a smaller image.')
        uploadedPath = `${user.clubId}/${type}/${crypto.randomUUID()}.png`
        const result = await supabase.storage.from('club-kits').upload(uploadedPath, blob, { contentType: 'image/png', upsert: false })
        if (result.error) throw result.error
        imagePath = uploadedPath
      }
      const result = await supabase.from('club_kits').upsert({ club_id: user.clubId, kit_type: type, colour: kit.colour, image_path: imagePath }, { onConflict: 'club_id,kit_type' }).select('colour,image_path').single()
      if (result.error) throw result.error
      const next = normalizeClubKit(result.data)
      setKit(next); setPending(null); setPicker(false); onSaved(next); setMessage(`${label} saved.`)
      if (savedKit?.imagePath && savedKit.imagePath !== imagePath) await supabase.storage.from('club-kits').remove([savedKit.imagePath]).catch(() => {})
    } catch (failure) {
      if (uploadedPath) await supabase.storage.from('club-kits').remove([uploadedPath])
      setError(failure.message || 'Kit could not be saved. Please try again.')
    } finally { setBusy(false) }
  }
  return <div className="space-y-3" aria-label={`${label} editor`}>
    <h3 className="text-lg font-bold">{label}</h3>
    <button type="button" className={buttonClass} disabled={busy} aria-label={hasImage ? `Replace ${label} image` : `Choose ${label} colour`} aria-expanded={!hasImage && picker} onClick={() => hasImage ? upload.current.click() : setPicker(value => !value)}>
      {pending ? <span>New image ready below</span> : <KitArtwork kit={kit} label={label} size={96} />}
    </button>
    {!hasImage && picker ? <div className="space-y-3">
      <label className="flex items-center gap-3">Colour <input aria-label={`${label} colour`} type="color" value={kit.colour} onChange={event => setKit(value => ({ ...value, colour: event.target.value }))} /></label>
      <div className="flex flex-wrap gap-2">{['#1d4ed8','#dc2626','#15803d','#facc15','#ffffff','#111827'].map(colour => <button type="button" key={colour} aria-label={`Use ${colour}`} className="h-11 w-11 rounded border border-gray-400" style={{ backgroundColor: colour }} onClick={() => setKit(value => ({ ...value, colour }))} />)}</div>
      <label className="flex items-center gap-3">Colour code <input className={`${inputClass} min-w-0 flex-1`} aria-label={`${label} colour code`} value={kit.colour} maxLength={7} onChange={event => setKit(value => ({ ...value, colour: event.target.value }))} /></label>
      {typeof window.EyeDropper === 'function' ? <button type="button" className={buttonClass} onClick={eyedropper}>Pick from screen</button> : <p className="text-sm">Screen sampling is unavailable in this browser. Pick a colour or sample an image below.</p>}
      <label className="block">Sample colour from an image<input className="block max-w-full" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void chooseFile(event.target.files?.[0], true); event.target.value = '' }} /></label>
      {reference ? <><p>Click the colour you want in this image.</p><canvas ref={sampleCanvas} width={512} height={512} aria-label="Colour sample image" style={{ width: '100%', maxWidth: 256, cursor: 'crosshair' }} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        const pixel = event.currentTarget.getContext('2d').getImageData(Math.min(511, Math.max(0, Math.floor((event.clientX - rect.left) * 512 / rect.width))), Math.min(511, Math.max(0, Math.floor((event.clientY - rect.top) * 512 / rect.height))), 1, 1).data
        if (pixel[3]) setKit(value => ({ ...value, colour: '#' + [...pixel].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('') }))
      }} /></> : null}
    </div> : null}
    <div className="space-y-2 border border-dashed border-[var(--border-color,#b8c7c0)] p-3" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void chooseFile(event.dataTransfer.files?.[0]) }}>
      <label className="block font-semibold">{hasImage ? 'Replace kit image' : 'Upload kit image'}<input ref={upload} className="block max-w-full font-normal" disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} /></label>
      <p className="text-sm">Or drag and drop a PNG, JPG or WebP here. Up to 10MB.</p>
    </div>
    {pending ? <div className="space-y-2"><canvas ref={canvas} width={512} height={512} aria-label={`${label} image preview`} style={{ width: '100%', maxWidth: 256, border: '1px solid #b8c7c0' }} />{[['zoom', 'Zoom', 1, 4, 0.05], ['x', 'Horizontal position', -1, 1, 0.01], ['y', 'Vertical position', -1, 1, 0.01]].map(([key, text, min, max, step]) => <label className="flex items-center gap-2" key={key}>{text}<input aria-label={`${label} ${text}`} className="min-w-0 flex-1" type="range" min={min} max={max} step={step} value={transform[key]} onChange={event => setTransform(value => ({ ...value, [key]: Number(event.target.value) }))} /></label>)}</div> : null}
    {hasImage ? <><p className="text-sm">Your image keeps its original colours. Kit colours do not change it.</p><button type="button" className={buttonClass} disabled={busy} onClick={() => { setPending(null); setKit(value => ({ ...value, imagePath: null })); setPicker(true) }}>Remove image</button></> : null}
    <button type="button" className={buttonClass} disabled={busy || !/^#[0-9a-f]{6}$/i.test(kit.colour)} onClick={() => void save()}>{busy ? 'Saving...' : `Save ${label}`}</button>
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </div>
}
