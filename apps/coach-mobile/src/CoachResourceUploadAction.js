import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, Pressable, Text, View } from 'react-native'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { invalidateMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { buildCoachResourceUploadUrl, canOpenCoachResourceUpload, isCoachResourceReturn } from '../../../src/lib/coach-resource-upload-handoff.js'

export function CoachResourceUploadAction({ user, stale, load, styles }) {
  const [opening, setOpening] = useState(false)
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const openingRef = useRef(false)
  const generation = useRef(0)
  const scope = `${user?.id}:${user?.clubId}:${user?.activeTeamId}`
  const allowed = canOpenCoachResourceUpload(user, stale)
  useEffect(() => {
    const attempt = ++generation.current
    pending.current = false; openingRef.current = false; setOpening(false); setNotice('')
    if (!allowed) return undefined
    const refresh = () => {
      if (!pending.current || generation.current !== attempt) return
      pending.current = false
      invalidateMobileResource(user, 'coach:phase31e:resources')
      setNotice('Refreshing resources from your team...')
      Promise.resolve(load({ silent: true, reuseFresh: false })).then(ok => {
        if (generation.current === attempt) setNotice(ok === false ? 'Resources could not refresh. Pull to refresh when connected.' : 'Resources refreshed. Uploads are available after the browser confirms they have saved.')
      }).catch(() => { if (generation.current === attempt) setNotice('Resources could not refresh. Pull to refresh when connected.') })
    }
    const links = Linking.addEventListener('url', ({ url }) => { if (isCoachResourceReturn(url)) refresh() })
    const resumes = AppState.addEventListener('change', state => { if (state === 'active') refresh() })
    return () => { generation.current += 1; links.remove(); resumes.remove() }
  }, [allowed, scope, user, load])
  async function open() {
    if (openingRef.current) return
    openingRef.current = true; setOpening(true); setNotice('Opening your phone browser...')
    const attempt = generation.current
    try {
      pending.current = true
      await Linking.openURL(buildCoachResourceUploadUrl(getMobileRuntimeConfig('coach').apiBaseUrl, user))
      if (generation.current === attempt) setNotice('Choose files or photos in your browser, then return to Coach. Sign in there if needed.')
    } catch {
      if (generation.current === attempt) { pending.current = false; setNotice('The upload page could not open. Try again.') }
    } finally {
      if (generation.current === attempt) { openingRef.current = false; setOpening(false) }
    }
  }
  if (!allowed) return null
  return <View style={{ borderBottomWidth: 1, borderBottomColor: styles.divider.backgroundColor, paddingVertical: 8 }}>
    <Pressable accessibilityRole="button" disabled={opening} onPress={() => void open()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={styles.heading}>{opening ? 'Opening upload...' : 'Upload files or photos'}</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={styles.helper}>{notice || 'Upload securely in your phone browser. Your selected team stays the same.'}</Text>
  </View>
}
