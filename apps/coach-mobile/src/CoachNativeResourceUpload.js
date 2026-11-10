import { requireOptionalNativeModule } from 'expo'
import * as Crypto from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import { useEffect, useRef, useState } from 'react'
import { Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { CoachResourceUploadAction } from './CoachResourceUploadAction'
import { assertCoachOperationalMutation, getCoachEntryIdentity, recordCoachOperationalAudit } from '../../mobile-core/src/coachOperationalData'
import { invalidateMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { supabase } from '../../mobile-core/src/supabase'
import { canOpenCoachResourceUpload, verifyCoachResourceUploadScope } from '../../../src/lib/coach-resource-upload-handoff.js'
import { isDemoEmail } from '../../../src/lib/demo.js'
import { RESOURCE_LIBRARY_ALLOWED_MIME_TYPES, validateResourceLibraryFile, writeResourceLibraryUpload } from '../../../src/lib/resource-library-upload.js'

function releasePickedFile(file) {
  if (!file?.uri.startsWith(Paths.cache.uri)) return
  try { file.delete() } catch { /* The picker cache can already have expired. */ }
}

async function pickResource(source) {
  if (source === 'gallery') {
    const { launchImageLibraryAsync } = require('expo-image-picker')
    return launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      preferredAssetRepresentationMode: 'compatible',
    })
  }
  const { getDocumentAsync } = require('expo-document-picker')
  return getDocumentAsync({
    type: [...RESOURCE_LIBRARY_ALLOWED_MIME_TYPES],
    copyToCacheDirectory: true,
  })
}

function resourceFile(asset, file) {
  const mimeType = [file.type, asset.mimeType].find(type => type && type !== 'application/octet-stream') || ''
  const name = asset.name || asset.fileName || file.name
  const fileName = mimeType === 'image/jpeg' && !/\.jpe?g$/i.test(name)
    ? `${name.replace(/\.[^.]+$/, '')}.jpg`
    : name
  return { name: fileName, size: file.size, type: mimeType }
}

function UploadButton({ label, disabled, onPress, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, opacity: disabled ? 0.55 : 1 }}>
    <Text style={styles.heading}>{label}</Text>
  </Pressable>
}

function NativeUpload({ user, stale, load, styles }) {
  const [selected, setSelected] = useState(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(false)
  const selectedRef = useRef(null)
  const busyRef = useRef(false)
  const allowed = canOpenCoachResourceUpload(user, stale)
  const allowedRef = useRef(allowed)
  allowedRef.current = allowed
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      releasePickedFile(selectedRef.current)
    }
  }, [])

  const choose = async (source) => {
    if (!allowedRef.current || busyRef.current) return
    busyRef.current = true
    setBusy('picking')
    setNotice('')
    Keyboard.dismiss()
    let picked
    try {
      const result = await pickResource(source)
      if (result.canceled) return
      const asset = result.assets[0]
      picked = new File(asset.uri)
      if (!mounted.current || !allowedRef.current) return
      const details = resourceFile(asset, picked)
      validateResourceLibraryFile(details)
      releasePickedFile(selectedRef.current)
      selectedRef.current = picked
      setSelected(details)
      setTitle(details.name.replace(/\.[^.]+$/, ''))
    } catch (error) {
      if (mounted.current) setNotice(error.message || 'The file could not be selected.')
    } finally {
      if (picked !== selectedRef.current) releasePickedFile(picked)
      busyRef.current = false
      if (mounted.current) setBusy('')
    }
  }

  const upload = async () => {
    if (!allowedRef.current || busyRef.current || !selected || !title.trim()) return
    const file = selectedRef.current
    busyRef.current = true
    setBusy('uploading')
    setNotice('')
    Keyboard.dismiss()
    try {
      assertCoachOperationalMutation(user, { minimumRank: 50, requiresTeam: true })
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      if (user.isDemoAccount || isDemoEmail(data.session?.user?.email)) throw new Error('The demo account cannot upload resources.')
      const verified = await verifyCoachResourceUploadScope(supabase, user, { clubId: user.clubId, teamId: user.activeTeamId }, data.session?.user?.id)
      if (!mounted.current || !allowedRef.current) return
      validateResourceLibraryFile({ ...selected, size: file.size })
      const body = await file.arrayBuffer()
      if (!mounted.current || !allowedRef.current) return
      const resourceId = Crypto.randomUUID()
      const cleanTitle = title.trim()
      await writeResourceLibraryUpload(supabase, {
        id: resourceId,
        clubId: verified.clubId,
        teamId: verified.activeTeamId,
        title: cleanTitle,
        file: { ...selected, size: body.byteLength },
        body,
        uploadedByProfileId: verified.id,
        uploadedBy: getCoachEntryIdentity(verified, 'uploaded'),
      })
      void recordCoachOperationalAudit({
        user: verified,
        action: 'resource_library_item_uploaded',
        entityType: 'resource_library_item',
        entityId: resourceId,
        metadata: { title: cleanTitle, category: 'general' },
      }).catch(() => {})
      invalidateMobileResource(verified, 'coach:phase31e:resources')
      releasePickedFile(file)
      if (!mounted.current) return
      selectedRef.current = null
      setSelected(null)
      setTitle('')
      setNotice('Resource uploaded.')
      try {
        if (await load({ silent: true, reuseFresh: false }) === false && mounted.current) {
          setNotice('Resource uploaded. Pull to refresh the list.')
        }
      } catch {
        if (mounted.current) setNotice('Resource uploaded. Pull to refresh the list.')
      }
    } catch (error) {
      if (mounted.current) setNotice(error.message || 'The resource could not be uploaded.')
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy('')
    }
  }

  if (!allowed) return null
  return <View style={{ borderBottomWidth: 1, borderBottomColor: styles.divider.backgroundColor, paddingVertical: 8, gap: 6 }}>
    <Text style={styles.heading}>Upload files or photos</Text>
    <View style={styles.row}>
      <UploadButton disabled={Boolean(busy)} label="Gallery" onPress={() => void choose('gallery')} styles={styles} />
      <UploadButton disabled={Boolean(busy)} label="Documents" onPress={() => void choose('documents')} styles={styles} />
    </View>
    {selected ? <>
      <Text numberOfLines={1} style={styles.helper}>{selected.name}</Text>
      <TextInput accessibilityLabel="Resource title" editable={!busy} onChangeText={setTitle} style={styles.input} value={title} />
      <UploadButton disabled={Boolean(busy) || !title.trim()} label={busy === 'uploading' ? 'Uploading...' : 'Upload resource'} onPress={() => void upload()} styles={styles} />
    </> : null}
    <Text accessibilityLiveRegion="polite" style={styles.helper}>{notice || 'Choose a photo or document up to 20 MB.'}</Text>
  </View>
}

export function CoachNativeResourceUpload(props) {
  const { user } = props
  const nativePickers = Platform.OS !== 'web'
    && requireOptionalNativeModule('ExponentImagePicker') && requireOptionalNativeModule('ExpoDocumentPicker')
  if (!nativePickers) return <CoachResourceUploadAction {...props} />
  return <NativeUpload key={`${user?.id}:${user?.clubId}:${user?.activeTeamId}:${user?.role}:${user?.roleRank}`} {...props} />
}
