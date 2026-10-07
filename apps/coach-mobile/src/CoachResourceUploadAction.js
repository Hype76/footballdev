import { useEffect, useRef, useState } from 'react'
import { AppState, Keyboard, Linking, Pressable, Text, View } from 'react-native'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { invalidateMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { buildCoachResourceUploadUrl, canOpenCoachResourceUpload, isCoachResourceReturn } from '../../../src/lib/coach-resource-upload-handoff.js'

export function CoachResourceUploadAction({ user, stale, load, styles }) {
  const [opening, setOpening] = useState(false)
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const openingRef = useRef(false)
  const openRequest = useRef(0)
  const generation = useRef(0)
  const userRef = useRef(user)
  const loadRef = useRef(load)
  userRef.current = user
  loadRef.current = load
  const scope = `${user?.id}:${user?.clubId}:${user?.activeTeamId}:${user?.role}:${user?.roleRank}`
  const allowed = canOpenCoachResourceUpload(user, stale)
  useEffect(() => {
    const attempt = ++generation.current
    pending.current = false; openingRef.current = false; openRequest.current += 1; setOpening(false); setNotice('')
    if (!allowed) return undefined
    const refresh = () => {
      Keyboard.dismiss()
      if (!pending.current || generation.current !== attempt) return
      pending.current = false
      openRequest.current += 1
      openingRef.current = false; setOpening(false)
      invalidateMobileResource(userRef.current, 'coach:phase31e:resources')
      setNotice('Refreshing resources from your team...')
      Promise.resolve().then(() => loadRef.current({ silent: true, reuseFresh: false })).then(ok => {
        if (generation.current === attempt) setNotice(ok === false ? 'Resources could not refresh. Pull to refresh when connected.' : 'Resources refreshed. Uploads are available after the browser confirms they have saved.')
      }).catch(() => { if (generation.current === attempt) setNotice('Resources could not refresh. Pull to refresh when connected.') })
    }
    const links = Linking.addEventListener('url', ({ url }) => { if (isCoachResourceReturn(url)) refresh() })
    const resumes = AppState.addEventListener('change', state => { if (state === 'active') refresh() })
    return () => { generation.current += 1; links.remove(); resumes.remove(); Keyboard.dismiss() }
  }, [allowed, scope])
  async function open() {
    Keyboard.dismiss()
    if (!allowed || !canOpenCoachResourceUpload(userRef.current, stale) || openingRef.current) return
    openingRef.current = true; setOpening(true); setNotice('Opening your phone browser...')
    const attempt = generation.current
    const request = ++openRequest.current
    try {
      pending.current = true
      await Linking.openURL(buildCoachResourceUploadUrl(getMobileRuntimeConfig('coach').apiBaseUrl, user))
      if (generation.current === attempt && openRequest.current === request && pending.current) setNotice('Choose files or photos in your browser, then return to Coach. Sign in there if needed.')
    } catch {
      if (generation.current === attempt && openRequest.current === request) { pending.current = false; setNotice('The upload page could not open. Try again.') }
    } finally {
      if (generation.current === attempt && openRequest.current === request) { openingRef.current = false; setOpening(false) }
    }
  }
  if (!allowed) return null
  return <View style={{ borderBottomWidth: 1, borderBottomColor: styles.divider.backgroundColor, paddingVertical: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={opening ? 'Opening upload...' : 'Upload files or photos'} accessibilityHint="Opens the secure upload page in your phone browser" accessibilityState={{ disabled: opening }} disabled={opening} onPress={() => void open()} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[styles.heading, { flex: 1 }]}>{opening ? 'Opening upload...' : 'Upload files or photos'}</Text>
      <Text style={styles.heading}>{opening ? 'Opening...' : 'Open upload ›'}</Text>
    </Pressable>
    <Text accessibilityLiveRegion="polite" style={styles.helper}>{notice || 'Tap Open upload to choose files or photos in your browser. Sign in with your Coach account if asked. Your selected team stays the same.'}</Text>
  </View>
}
