import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, Image, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Crypto from 'expo-crypto'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { fanBrandingLink, fanBrandTheme } from '../../../src/lib/fan-branding'
import QRCode from 'qrcode/lib/core/qrcode'
import { supabase, getAccessToken } from '../../mobile-core/src/supabase'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { useMobileAuth } from '../../mobile-core/src/auth'
import { FAN_ACCESS, fanAccessSummary, fanInviteUrl, normalizeFanPermissions, validateFanInvite } from '../../../src/lib/fans'
import { useFans } from '../../../src/lib/use-fans'
import { fetchFansJson } from '../../../src/lib/fans-fetch'
import ParentIcon from './ParentIcon'
import { DEFAULT_PARENT_MOBILE_THEME } from '../../mobile-core/src/parentThemeCore'
const FansTheme = createContext(DEFAULT_PARENT_MOBILE_THEME.tokens)
import { FanContent } from './FanContent'
import { formatParentProductDateTime } from '../../mobile-core/src/parentDateTimeCore'
import { themeForeground } from '../../mobile-core/src/themeContrast'

function FanSwitch({ value, disabled = false, accessibilityLabel, onValueChange }) {
  const tokens = useContext(FansTheme)
  const track = value ? tokens.accentText : tokens.borderStrong
  return <View style={{ alignItems: 'center', gap: 4 }}>
    <Switch accessibilityLabel={accessibilityLabel} accessibilityHint={disabled ? 'Enable Development records first' : undefined} disabled={disabled} value={value} onValueChange={onValueChange}
      trackColor={{ false: tokens.borderStrong, true: tokens.accentText }} ios_backgroundColor={tokens.borderStrong} thumbColor={themeForeground(track)}
      {...(Platform.OS === 'web' ? { activeThumbColor: themeForeground(track) } : {})} />
    <Text style={{ color: tokens.textPrimary, fontSize: 13, fontWeight: '700' }}>{disabled ? 'Unavailable' : value ? 'On' : 'Off'}</Text>
  </View>
}

async function rpc(name, args = {}) { const { data, error } = await supabase.rpc(name, args); if (error) throw error; return data }
async function request(body) {
  const token = await getAccessToken()
  const origin = getMobileRuntimeConfig('parent').apiBaseUrl.replace(/\/$/, '')
  return fetchFansJson(`${origin}/.netlify/functions/fans`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
}
function Action({ icon, label, onPress, disabled, primary = false }) {
  const tokens = useContext(FansTheme)
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.action, primary && styles.primaryAction, disabled && { opacity: 0.5 }]}>{icon ? <ParentIcon iconKey={icon} color={primary ? tokens.accentForeground : tokens.accentText} size={25} /> : null}<Text style={[styles.actionLabel, primary && styles.primaryActionLabel]}>{label}</Text></Pressable>
}
function ClubBrand({ source }) {
  const brand = fanBrandingLink(source)
  const tokens = useContext(FansTheme)
  const [failedUrl, setFailedUrl] = useState('')
  if (!brand.clubName) return null
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: tokens.accent }}>
    {brand.clubLogoUrl && failedUrl !== brand.clubLogoUrl ? <Image accessibilityLabel={`${brand.clubName} logo`} source={{ uri: brand.clubLogoUrl }} onError={() => setFailedUrl(brand.clubLogoUrl)} resizeMode="contain" style={{ width: 56, height: 56, backgroundColor: '#fff', borderRadius: 8 }} /> : <Text style={{ color: tokens.accentText, fontSize: 28, fontWeight: '800' }}>{brand.clubName.slice(0, 1)}</Text>}
    <Text style={{ color: tokens.textPrimary, fontSize: 18, fontWeight: '800', flex: 1 }}>{brand.clubName}</Text>
  </View>
}
function Qr({ value }) {
  const matrix = useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'M' }).modules, [value])
  const size = 260 / (matrix.size + 8)
  return <View accessibilityLabel="Fan invitation QR code" style={{ backgroundColor: '#fff', padding: 4 * size, width: 260, height: 260 }}>
    {Array.from({ length: matrix.size }, (_, row) => <View key={row} style={{ flexDirection: 'row' }}>{Array.from({ length: matrix.size }, (_, column) => <View key={column} style={{ width: size, height: size, backgroundColor: matrix.get(row, column) ? '#000' : '#fff' }} />)}</View>)}
  </View>
}
export async function clearFanNotificationDevice() {
  const token = await SecureStore.getItemAsync('fan-notification-device')
  await SecureStore.deleteItemAsync('fan-notification-device')
  if (token) await request({ action: 'unregister_device', token }).catch(() => {})
}
export function FansScreen({ embedded = false, themeTokens, themeMode, onBack, selectedParentLinkId, onSelectedParentLinkChange, scrollViewRef }) {
  const [savedMode, setSavedMode] = useState('dark')
  useEffect(() => { let active = true; AsyncStorage.getItem('fp.parent.display-theme.v1').then((value) => { if (active && ['light', 'dark'].includes(value)) setSavedMode(value) }).catch(() => {}); return () => { active = false } }, [])
  const { user, signOut, refreshUserProfile } = useMobileAuth()
  const state = useFans({ rpc, request })
  const { clearView, reload, open } = state
  const parents = (user?.parentPortalLinks || []).filter((p) => p.linkType !== 'fan' && p.linkType !== 'family')
  const [parentId, setParentId] = useState(user?.selectedParentLinkId || parents[0]?.id || '')
  const parent = parents.find((p) => p.id === (selectedParentLinkId ?? parentId)) || parents[0]
  const brandSource = state.connections.find((c) => c.id === state.view?.connectionId) || parent || state.connections.find((c) => !c.is_owner && c.status === 'active')
  const displayMode = themeMode || savedMode
  const tokens = useMemo(() => brandSource ? fanBrandTheme(brandSource, displayMode).tokens : themeTokens || DEFAULT_PARENT_MOBILE_THEME.tokens, [brandSource, displayMode, themeTokens])
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [form, setForm] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [ready, setReady] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formation, setFormation] = useState(null)
  const localScrollRef = useRef(null)
  useEffect(() => {
    (scrollViewRef || localScrollRef).current?.scrollTo({ y: 0, animated: false })
  }, [state.view, scrollViewRef])
  const requestId = useRef('')
  const viewRef = useRef(null)
  viewRef.current = state.view
  const handledNotification = useRef('')
  const lastNotification = Notifications.useLastNotificationResponse()
  const run = async (action) => { setBusy(true); state.setError(''); try { await action() } catch (e) { state.setError(e.message) } finally { setBusy(false) } }
  useEffect(() => {
    const listener = AppState.addEventListener('change', (status) => { if (status !== 'active') { clearView(); setFormation(null); setReady(null) } else void reload().catch(() => {}) })
    return () => listener.remove()
  }, [clearView, reload])
  useEffect(() => {
    const data = lastNotification?.notification?.request?.content?.data
    const notificationId = lastNotification?.notification?.request?.identifier
    if (data?.route === 'fans' && data.fanConnectionId && notificationId !== handledNotification.current && state.connections.some((c) => c.id === data.fanConnectionId && c.permissions.game_day)) {
      handledNotification.current = notificationId
      void open(data.fanConnectionId, 'matches', data.matchDayId ? { matchId: data.matchDayId } : {})
    }
  }, [lastNotification, open, state.connections])
  useEffect(() => { setFormation(null) }, [state.view])
  const begin = (existing) => { clearView(); requestId.current = Crypto.randomUUID(); setReady(null); setForm(existing ? { id: existing.id, name: existing.name, email: existing.email, permissions: existing.permissions } : { name: '', email: '', permissions: normalizeFanPermissions({ game_day: true }) }) }
  const review = (mode) => { try { setConfirm({ ...validateFanInvite(form), id: form.id, mode, parentId: parent?.id, child: parent?.playerName }) } catch (e) { state.setError(e.message) } }
  const complete = () => run(async () => {
    const draft = confirm
    if (draft.id) await state.manage(draft.id, 'permissions', draft.permissions)
    else {
      const result = await rpc('create_fan_invitation', { parent_link_id_value: draft.parentId, name_value: draft.name, email_value: draft.email, permissions_value: draft.permissions, request_id_value: requestId.current })
      const url = fanInviteUrl('https://parent.footballplayer.online', result.invite_token)
      setReady({ ...result, url, mode: draft.mode }); setForm(null); setConfirm(null); await state.reload()
      if (draft.mode === 'email') await request({ action: 'send_invitation', connectionId: result.id })
      if (draft.mode === 'share') await Share.share({ message: `Fan invitation for ${draft.name}: ${url}`, url })
    }
    setForm(null); setConfirm(null); await state.reload()
  })
  const remove = (connection, self) => Alert.alert(self ? 'Remove my access' : 'End Fan access', `Access to ${connection.player_name} and associated notifications will end. A new invitation will be needed to restore access.`, [
    { text: 'Go back', style: 'cancel' }, { text: 'Remove access', style: 'destructive', onPress: () => run(async () => { state.clearView(); setFormation(null); await state.manage(connection.id, self ? 'remove' : 'revoke'); await refreshUserProfile() }) },
  ])
  const deleteInvitation = (connection) => Alert.alert('Delete cancelled invitation?', `Remove the cancelled invitation for ${connection.name} (${connection.email}) from your Fans list?`, [
    { text: 'Go back', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run(() => state.deleteInvitation(connection.id)) },
  ])
  const enableDevice = () => run(async () => {
    const permission = await Notifications.requestPermissionsAsync()
    if (permission.status !== 'granted') throw new Error('Notifications are not enabled in your phone settings.')
    const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
    await request({ action: 'register_device', token })
    await SecureStore.setItemAsync('fan-notification-device', token)
    Alert.alert('Notifications enabled', 'You can change alerts separately for each child you follow.')
  })
  const openResource = (resource) => run(async () => {
    const currentView = state.view
    const result = await request({ action: 'open_resource', connectionId: currentView.connectionId, resourceId: resource.id })
    if (viewRef.current !== currentView) return
    if (result.formationBoard) setFormation({ ...result.formationBoard, resourceId: resource.id })
    else if (/^https:\/\//.test(result.accessUrl || '')) await Linking.openURL(result.accessUrl)
    else throw new Error('This resource could not be opened.')
  })
  const viewTitle = { schedule: 'Schedule', matches: 'Game Day', development: 'Development records', resources: 'Resources', notifications: 'Notifications' }[state.view?.action] || 'Shared items'
  const closeContent = () => { state.clearView(); setFormation(null) }
  const content = <FansTheme.Provider value={tokens}><View style={[styles.container, { backgroundColor: tokens.portalSurface }]}><ClubBrand source={brandSource} />
    {state.view ? <>
      <Action label="Back to Fans" icon="action.back" onPress={closeContent} />
      <Text style={styles.label}>{brandSource?.player_name}</Text>
      {state.contentError ? <View><Text accessibilityRole="alert" style={styles.error}>{state.contentError}</Text><Action label="Try again" onPress={() => state.open(state.view.connectionId, state.view.action, state.view.matchId ? { matchId: state.view.matchId } : {})} /></View> : !state.content ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textPrimary }}>Loading {viewTitle.toLowerCase()}...</Text> : <FanContent key={`${state.view.connectionId}:${state.view.action}`} connection={brandSource} view={state.view} content={state.content} formation={formation} onCloseFormation={() => setFormation(null)} onOpenResource={openResource} onOpenLink={(url) => run(() => Linking.openURL(url))} onOpen={(action, details) => state.open(state.view.connectionId, action, details)} themeTokens={tokens} />}
    </> : <>
    {onBack ? <Action label="Back to Parent app" icon="action.back" onPress={onBack} /> : null}
    <View style={styles.row}><ParentIcon iconKey="fans" color={tokens.accentText} size={30} /><Text accessibilityRole="header" style={styles.title}>Fans</Text></View>
    <Text style={styles.helper}>Choose who follows your child and what they can see.</Text>
    {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
    {state.loading ? <Text style={{ color: tokens.textPrimary }}>Loading Fans...</Text> : null}
    {parents.length ? <>
      <View style={styles.actions}>{parents.map((p) => <Action key={p.id} icon="child" label={`${p.playerName}${parent?.id === p.id ? ' (selected)' : ''}`} disabled={busy} onPress={() => { setParentId(p.id); onSelectedParentLinkChange?.(p.id); setForm(null); setReady(null); state.clearView() }} />)}</View>
      <Action primary icon="person-add" label="Invite a Fan" disabled={busy} onPress={() => begin()} />
      {form ? <View>
        <Text style={styles.label}>Name</Text><TextInput accessibilityLabel="Fan name" autoComplete="name" editable={!form.id} maxLength={120} value={form.name} onChangeText={(name) => setForm({ ...form, name })} style={styles.input} />
        <Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Fan email" autoComplete="email" autoCapitalize="none" keyboardType="email-address" editable={!form.id} maxLength={254} value={form.email} onChangeText={(email) => setForm({ ...form, email })} style={styles.input} />
        <Text style={styles.label}>Choose access</Text>{FAN_ACCESS.map((item) => <View style={styles.permission} key={item.key}><ParentIcon iconKey={item.icon} color={tokens.accentText} size={26} /><View style={styles.copy}><Text style={styles.label}>{item.label}</Text><Text style={styles.helper}>{item.description}</Text></View><FanSwitch accessibilityLabel={item.label} disabled={item.key === 'resources' && !form.permissions.development} value={form.permissions[item.key]} onValueChange={(value) => setForm({ ...form, permissions: normalizeFanPermissions({ ...form.permissions, [item.key]: value }) })} /></View>)}
        <View style={styles.actions}>{form.id ? <Action label="Review changes" onPress={() => review('edit')} /> : <><Action icon="fan.email" label="Email" onPress={() => review('email')} disabled={busy} /><Action icon="fan.qr" label="QR code" onPress={() => review('qr')} disabled={busy} /><Action icon="fan.share" label="Share link" onPress={() => review('share')} disabled={busy} /></>}<Action label="Cancel" onPress={() => setForm(null)} /></View>
      </View> : null}
      {ready ? <View><Text style={{ color: tokens.textPrimary }}>Invitation ready for {ready.name} ({ready.email}). Expires {formatParentProductDateTime(ready.expires_at, { year: 'numeric' })}.</Text>{ready.mode === 'qr' ? <Qr value={ready.url} /> : null}<View style={styles.actions}><Action icon="fan.share" label="Share invitation" onPress={() => Share.share({ message: ready.url })} /><Action icon="fan.email" label="Send email" onPress={() => run(() => request({ action: 'send_invitation', connectionId: ready.id }))} /></View></View> : null}
      <Text accessibilityRole="header" style={styles.heading}>Your child's Fans</Text>
      {state.connections.filter((c) => c.is_owner && c.parent_link_id === parent?.id).map((c) => <View style={styles.person} key={c.id}><View style={styles.row}><ParentIcon iconKey="fans" color={tokens.accentText} size={26} /><View style={styles.copy}><Text style={styles.label}>{c.name}</Text><Text style={{ color: tokens.textPrimary }}>{c.email}</Text><Text style={styles.helper}>{c.status} · {FAN_ACCESS.filter((p) => c.permissions[p.key]).map((p) => p.label).join(', ')}</Text></View></View>{['active', 'pending'].includes(c.status) ? <View style={styles.actions}><Action label="Edit access" onPress={() => begin(c)} /><Action label={c.status === 'pending' ? 'Cancel invitation' : 'Revoke access'} onPress={() => remove(c, false)} /></View> : null}{c.status === 'cancelled' ? <Action icon="delete-outline" label="Delete" disabled={busy} onPress={() => deleteInvitation(c)} /> : null}</View>)}
    </> : null}
    <Text accessibilityRole="header" style={styles.heading}>Children you follow</Text>
    {state.connections.filter((c) => !c.is_owner && c.status === 'active').map((c) => <FansTheme.Provider key={c.id} value={fanBrandTheme(c, displayMode).tokens}><View style={styles.person}><ClubBrand source={c} /><View style={styles.row}><ParentIcon iconKey="child" color={tokens.accentText} size={28} /><View style={styles.copy}><Text style={styles.label}>{c.player_name}</Text><Text style={styles.helper}>{c.club_name} · {c.team_name}</Text></View></View><View style={styles.actions}>{FAN_ACCESS.filter((p) => c.permissions[p.key]).map((p) => <Action key={p.key} icon={p.icon} label={p.label} onPress={() => { setFormation(null); void state.open(c.id, p.key === 'game_day' ? 'matches' : p.key) }} />)}</View>{c.permissions.game_day ? <><View style={styles.row}><Text style={[styles.copy, styles.label]}>Game Day notifications</Text><FanSwitch accessibilityLabel={`Game Day notifications for ${c.player_name}`} value={c.notifications_enabled} onValueChange={(v) => run(() => state.manage(c.id, v ? 'notifications_on' : 'notifications_off'))} /></View><Action label="View notifications" onPress={() => state.open(c.id, 'notifications')} /></> : null}<Action icon="fan.remove" label="Remove my access" onPress={() => remove(c, true)} /></View></FansTheme.Provider>)}

    {state.connections.some((c) => !c.is_owner && c.status === 'active' && c.permissions.game_day) ? <Action label="Enable phone notifications" icon="notifications" onPress={enableDevice} /> : null}
    {!embedded ? <Action label="Sign out" onPress={() => run(async () => { state.clearView(); await signOut() })} /> : null}
    </>}
    <Modal visible={Boolean(confirm)} transparent animationType="fade" onRequestClose={() => { if (!busy) setConfirm(null) }}>
      <View style={styles.overlay}><ScrollView contentContainerStyle={styles.modal}><Text accessibilityRole="header" style={styles.heading}>Confirm Fan access</Text>{confirm ? <><Text style={{ color: tokens.textPrimary }}>{confirm.id ? 'You are updating access for' : 'You are inviting'} {confirm.name} ({confirm.email}) to follow {confirm.child}.</Text>{fanAccessSummary(confirm.permissions).map((line) => <Text style={styles.permissionText} key={line}>{line}</Text>)}<Text style={{ color: tokens.textPrimary }}>This person cannot invite others, use parent chat, respond to attendance or change your child's information. Either of you can end this access.</Text></> : null}<View style={styles.actions}><Action label="Go back" disabled={busy} onPress={() => setConfirm(null)} /><Action label={confirm?.id ? 'Confirm changes' : 'Confirm invitation'} disabled={busy} onPress={complete} /></View></ScrollView></View>
    </Modal>
  </View></FansTheme.Provider>
  return embedded ? content : <SafeAreaView style={styles.safe}><ScrollView ref={localScrollRef} keyboardShouldPersistTaps="handled">{content}</ScrollView></SafeAreaView>
}
function createStyles(tokens) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.portalSurface }, container: { backgroundColor: tokens.portalBackground, padding: 18, gap: 12 }, title: { fontSize: 26, fontWeight: '800', color: tokens.textPrimary }, heading: { fontSize: 20, fontWeight: '700', marginTop: 16, color: tokens.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, copy: { flex: 1 }, helper: { color: tokens.textSecondary, fontSize: 14, lineHeight: 20 }, label: { color: tokens.textPrimary, fontWeight: '700', fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, action: { minHeight: 46, paddingVertical: 10, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, actionLabel: { color: tokens.accentText, fontWeight: '700' },
  primaryAction: { minHeight: 54, justifyContent: 'center', paddingHorizontal: 18, marginVertical: 8, borderRadius: 10, backgroundColor: tokens.buttonPrimary }, primaryActionLabel: { fontSize: 17, color: tokens.accentForeground },
  input: { minHeight: 48, borderWidth: 1, borderColor: tokens.border, borderRadius: 8, padding: 12, marginVertical: 8, color: tokens.textPrimary }, permission: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: tokens.border },
  person: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: tokens.border, gap: 6 }, error: { color: tokens.danger }, overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 }, modal: { backgroundColor: tokens.portalSurface, padding: 22, gap: 16, borderRadius: 12 }, permissionText: { fontWeight: '600', color: tokens.textPrimary },
}) }
