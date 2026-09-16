import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, Image, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native'
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
import { FanPlayerCard } from './FanPlayerCard'
import { PartnersBanner, PartnersScreen } from './PartnersScreen'
import { readFanDeviceNotifications, enableFanDeviceNotifications } from './fanDeviceNotifications'
import { formatParentProductDateTime } from '../../mobile-core/src/parentDateTimeCore'
import { mixThemeColor, themeForeground } from '../../mobile-core/src/themeContrast'

function FanSwitch({ value, disabled = false, accessibilityLabel, onValueChange, inline = false }) {
  const tokens = useContext(FansTheme)
  const track = value ? tokens.accentText : tokens.borderStrong
  return <View style={{ alignItems: 'center', gap: inline ? 8 : 4, flexDirection: inline ? 'row' : 'column' }}>
    <Switch accessibilityLabel={accessibilityLabel} accessibilityHint={disabled && !inline ? 'Enable Development records first' : undefined} disabled={disabled} value={value} onValueChange={onValueChange}
      trackColor={{ false: tokens.borderStrong, true: tokens.accentText }} ios_backgroundColor={tokens.borderStrong} thumbColor={themeForeground(track)}
      {...(Platform.OS === 'web' ? { activeThumbColor: themeForeground(track) } : {})} />
    <Text style={{ color: tokens.textPrimary, fontSize: 13, fontWeight: '700' }}>{disabled && !inline ? 'Unavailable' : value ? 'On' : 'Off'}</Text>
  </View>
}

async function rpc(name, args = {}) { const { data, error } = await supabase.rpc(name, args); if (error) throw error; return data }
async function request(body) {
  const token = await getAccessToken()
  const origin = getMobileRuntimeConfig('parent').apiBaseUrl.replace(/\/$/, '')
  return fetchFansJson(`${origin}/.netlify/functions/fans`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
}
function Action({ icon, label, onPress, disabled, primary = false, compact = false }) {
  const tokens = useContext(FansTheme)
  const styles = useMemo(() => createStyles(tokens), [tokens])
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.action, primary && styles.primaryAction, compact && styles.compactAction, disabled && { opacity: 0.5 }]}>{icon ? <ParentIcon iconKey={icon} color={primary ? tokens.accentForeground : tokens.accentText} size={compact ? 22 : 25} /> : null}<Text style={[styles.actionLabel, primary && styles.primaryActionLabel, compact && { fontSize: 14 }]}>{label}</Text></Pressable>
}
function OwnedFanRow({ connection, busy, onEdit, onRemove, onRenew, onDelete }) {
  const tokens = useContext(FansTheme)
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [expanded, setExpanded] = useState(false)
  const { width } = useWindowDimensions()
  const narrow = width < 360
  const status = connection.status
  const iconAction = (label, icon, onPress, destructive = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={`${label} for ${connection.name}`} disabled={busy} onPress={onPress} style={[styles.fanIconAction, busy && { opacity: 0.5 }]}><ParentIcon iconKey={icon} color={destructive ? tokens.danger : tokens.accentText} size={21} /></Pressable>
  const detailLabel = `${expanded ? 'Hide' : 'Show'} access for ${connection.name}`
  return <View testID={`owner-fan-${connection.id}`} style={styles.ownerFan}>
    <View style={styles.ownerFanRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={detailLabel} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.fanIdentity}>
        {!narrow ? <ParentIcon iconKey={connection.relationship_type === 'player' ? 'child' : 'fans'} color={tokens.accentText} size={24} /> : null}
        <View style={styles.copy}><Text numberOfLines={1} style={styles.fanName}>{connection.name}</Text><Text numberOfLines={1} style={styles.fanEmail}>{connection.email}</Text></View>
      </Pressable>
      <View style={styles.fanStatus}><ParentIcon iconKey="fiber-manual-record" color={status === 'active' ? tokens.success : tokens.textSecondary} size={9} /><Text style={styles.fanStatusText}>{status.slice(0, 1).toUpperCase() + status.slice(1)}</Text></View>
      <View style={styles.fanIconActions}>
        {status === 'active' ? <>{iconAction('Edit access', 'action.edit', onEdit)}{iconAction('Revoke access', 'delete-outline', onRemove, true)}</> : null}
        {['pending', 'expired'].includes(status) ? <>{iconAction('Resend link', 'fan.email', () => onRenew('email'))}{iconAction('Show QR code', 'fan.qr', () => onRenew('qr'))}</> : null}
        {status === 'cancelled' ? iconAction('Delete', 'delete-outline', onDelete, true) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${connection.name} details`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.fanIconAction}><ParentIcon iconKey={expanded ? 'section.collapse' : 'action.open'} color={tokens.textSecondary} size={21} /></Pressable>
      </View>
    </View>
    {expanded ? <View style={styles.fanDetails}>
      <Text style={styles.label}>{connection.name}</Text><Text selectable style={styles.helper}>{connection.email}</Text>
      <Text style={styles.helper}>{connection.relationship_type === 'player' ? 'Player account' : 'Fan account'} | {status.slice(0, 1).toUpperCase() + status.slice(1)}</Text>
      <Text style={styles.helper}>{FAN_ACCESS.filter(item => connection.permissions[item.key]).map(item => item.label).join(', ') || 'No shared access'}</Text>
      {status === 'pending' ? <View style={styles.actions}><Action icon="action.edit" label="Edit access" disabled={busy} onPress={onEdit} /><Action icon="delete-outline" label="Cancel invitation" disabled={busy} onPress={onRemove} /></View> : null}
    </View> : null}
  </View>
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
  const [convertAccount, setConvertAccount] = useState(null)
  const [formation, setFormation] = useState(null)
  const [section, setSection] = useState('home')
  const [signOutConfirm, setSignOutConfirm] = useState(false)
  const [joining, setJoining] = useState(false)
  const [invitationLink, setInvitationLink] = useState('')
  const [deviceNotifications, setDeviceNotifications] = useState({ status: 'checking' })
  const localScrollRef = useRef(null)
  useEffect(() => {
    (scrollViewRef || localScrollRef).current?.scrollTo({ y: 0, animated: false })
  }, [state.view, scrollViewRef])
  const requestId = useRef('')
  const renewalRequests = useRef(new Map())
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
  const reopenInvitation = (connection, mode) => {
    if (mode === 'qr' && connection.status === 'pending' && connection.invite_token) {
      setReady({ ...connection, url: fanInviteUrl('https://parent.footballplayer.online', connection.invite_token), mode })
      ;(scrollViewRef || localScrollRef).current?.scrollTo({ y: 0, animated: false })
      return
    }
    Alert.alert(mode === 'email' ? 'Resend Fan invitation?' : 'Renew Fan invitation?', `Create a fresh invitation for ${connection.name}? The previous link will stop working. Access permissions stay the same.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: mode === 'email' ? 'Resend link' : 'Show QR code', onPress: () => run(async () => {
        const renewalId = renewalRequests.current.get(connection.id) || Crypto.randomUUID()
        renewalRequests.current.set(connection.id, renewalId)
        const result = await rpc('renew_fan_invitation', { connection_id_value: connection.id, request_id_value: renewalId })
        setReady({ ...result, url: fanInviteUrl('https://parent.footballplayer.online', result.invite_token), mode })
        await state.reload()
        ;(scrollViewRef || localScrollRef).current?.scrollTo({ y: 0, animated: false })
        if (mode === 'email') await request({ action: 'send_invitation', connectionId: result.id })
        renewalRequests.current.delete(connection.id)
      }) },
    ])
  }
  const remove = (connection, self) => Alert.alert(self ? 'Remove my access' : 'End Fan access', `Access to ${connection.player_name} and associated notifications will end. A new invitation will be needed to restore access.`, [
    { text: 'Go back', style: 'cancel' }, { text: 'Remove access', style: 'destructive', onPress: () => run(async () => { state.clearView(); setFormation(null); await state.manage(connection.id, self ? 'remove' : 'revoke'); await refreshUserProfile() }) },
  ])
  const deleteInvitation = (connection) => Alert.alert('Delete cancelled invitation?', `Remove the cancelled invitation for ${connection.name} (${connection.email}) from your Fans list?`, [
    { text: 'Go back', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run(() => state.deleteInvitation(connection.id)) },
  ])
  useEffect(() => {
    if (section !== 'settings') return undefined
    let active = true
    let generation = 0
    const refresh = async () => {
      const current = ++generation
      if (Platform.OS === 'web') { setDeviceNotifications({ status: 'web' }); return }
      setDeviceNotifications({ status: 'checking' })
      try {
        const next = await readFanDeviceNotifications({ notifications: Notifications, secureStore: SecureStore, request })
        if (active && current === generation) setDeviceNotifications(next)
      } catch { if (active && current === generation) setDeviceNotifications({ status: 'unknown' }) }
    }
    void refresh()
    const listener = AppState.addEventListener('change', status => { if (status === 'active') void refresh() })
    return () => { active = false; listener.remove() }
  }, [section, busy, user?.id])
  const enableDevice = () => run(async () => {
    const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId
    const next = await enableFanDeviceNotifications({ notifications: Notifications, secureStore: SecureStore, request, projectId })
    setDeviceNotifications(next)
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
  const followed = state.connections.filter(c => !c.is_owner && c.status === 'active')
  const ownedFans = state.connections.filter(c => c.is_owner && c.parent_link_id === parent?.id)
  const showSection = next => { setSection(next); closeContent(); localScrollRef.current?.scrollTo({ y: 0, animated: false }) }
  const content = <FansTheme.Provider value={tokens}><View style={[styles.container, embedded && { padding: 0 }, { backgroundColor: state.view ? tokens.portalSurface : displayMode === 'light' ? '#f7f8fa' : tokens.portalBackground }]}>{!embedded && brandSource ? <ClubBrand source={brandSource} /> : null}
    {section === 'more' && !state.view ? <>
      <Text accessibilityRole="header" style={styles.title}>More</Text>
      <Action icon="settings" label="Settings" onPress={() => showSection('settings')} />
      <PartnersBanner onPress={() => showSection('partners')} />
      {embedded ? <Action label="Back to players" icon="action.back" onPress={() => showSection('home')} /> : null}
    </> : section === 'partners' && !state.view ? <>
      <Action label="Back to More" icon="action.back" onPress={() => showSection('more')} />
      <PartnersScreen appRole="parent" headingStyle={styles.title} textStyle={styles.helper} />
    </> : section === 'settings' && !state.view ? <>
      <Action label="Back to More" icon="action.back" onPress={() => showSection('more')} />
      <Text accessibilityRole="header" style={styles.title}>Settings</Text>
      <Text style={styles.helper}>Manage notifications and your linked players.</Text>
      {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
      {followed.some(c => c.permissions.game_day) ? <View style={{ gap: 8 }}>
        <Text style={styles.label}>Phone notifications</Text>
        <Text accessibilityLiveRegion="polite" style={styles.helper}>{({ checking: 'Checking phone notifications...', enabled: 'Phone notifications are enabled on this device.', off: 'Phone notifications are off on this device.', not_registered: 'This device is not registered for phone notifications.', unknown: 'Phone notification status could not be checked.', web: 'Phone notifications are available in the mobile app.' })[deviceNotifications.status]}</Text>
        <Text style={styles.helper}>The Game Day switch on each player chooses which alerts you follow. Phone notifications also need permission and registration on this device.</Text>
        {deviceNotifications.status === 'off' && deviceNotifications.canAskAgain === false ? <Action icon="settings" label="Open phone settings" disabled={busy} onPress={() => run(() => Linking.openSettings())} /> : ['off', 'not_registered', 'unknown'].includes(deviceNotifications.status) ? <Action icon="notifications" label={deviceNotifications.status === 'unknown' ? 'Retry phone notifications' : 'Enable phone notifications'} disabled={busy} onPress={enableDevice} /> : null}
      </View> : null}
      <Action icon="person-add" label="Open a Fan invitation" onPress={() => { setJoining(true); setInvitationLink('') }} />
      <Text accessibilityRole="header" style={styles.heading}>Linked players</Text>
      {followed.map(c => <View key={c.id} style={[styles.person, styles.row]}><View style={styles.copy}><Text style={styles.label}>{c.player_name}</Text><Text style={styles.helper}>{c.club_name} | {c.team_name}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove my access to ${c.player_name}`} accessibilityHint="Opens a confirmation before removing your access" disabled={busy} onPress={() => remove(c, true)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1 }}><ParentIcon iconKey="fan.remove" color={tokens.danger} size={22} /></Pressable></View>)}
      {!embedded ? <View style={styles.account}><Text accessibilityRole="header" style={styles.heading}>Account</Text><Text style={styles.helper}>{user?.email}</Text><Action icon="logout" label="Sign out" disabled={busy} onPress={() => setSignOutConfirm(true)} /></View> : <Action label="Back to players" icon="action.back" onPress={() => showSection('home')} />}
    </> : state.view ? <>
      <Action label="Back to Fans" icon="action.back" onPress={closeContent} />
      <Text style={styles.label}>{brandSource?.player_name}</Text>
      {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
      {state.contentError ? <View><Text accessibilityRole="alert" style={styles.error}>{state.contentError}</Text><Action label="Try again" onPress={() => state.open(state.view.connectionId, state.view.action, state.view.matchId ? { matchId: state.view.matchId } : {})} /></View> : !state.content ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textPrimary }}>Loading {viewTitle.toLowerCase()}...</Text> : <FanContent key={`${state.view.connectionId}:${state.view.action}`} connection={brandSource} view={state.view} content={state.content} formation={formation} onCloseFormation={() => setFormation(null)} onOpenResource={openResource} onOpenLink={(url) => run(() => Linking.openURL(url))} onOpen={(action, details) => state.open(state.view.connectionId, action, details)} themeTokens={tokens} />}
    </> : <>
    {onBack ? <Action label="Back to Parent app" icon="action.back" onPress={onBack} /> : null}
    <View style={styles.playersHeading}><View style={styles.copy}><Text accessibilityRole="header" style={styles.title}>Players</Text><Text style={styles.helper}>{parents.length ? 'Players linked to this account.' : 'Follow your players and view what has been shared with you.'}</Text></View>{parents.length ? <Action compact primary icon="person-add" label="Invite a Fan" disabled={busy} onPress={() => begin()} /> : null}</View>
    {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
    {state.loading ? <Text style={{ color: tokens.textPrimary }}>Loading Fans...</Text> : null}
    {parents.length ? <>
      <View style={styles.ownerPlayerList}>{parents.map((p) => <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.playerName}${parent?.id === p.id ? ' (selected)' : ''}`} accessibilityState={{ selected: parent?.id === p.id }} disabled={busy} onPress={() => { setParentId(p.id); onSelectedParentLinkChange?.(p.id); setForm(null); setReady(null); state.clearView() }} style={[styles.ownerPlayer, busy && { opacity: 0.5 }]}><ParentIcon iconKey="child" color={tokens.accentText} size={28} /><Text numberOfLines={1} style={styles.playerName}>{p.playerName}</Text>{parent?.id === p.id ? <Text style={styles.selectedBadge}>Selected</Text> : null}<View style={{ flex: 1 }} /><ParentIcon iconKey="action.open" color={tokens.textSecondary} size={21} /></Pressable>)}</View>
      {form ? <View>
        <Text style={styles.label}>Name</Text><TextInput accessibilityLabel="Fan name" autoComplete="name" editable={!form.id} maxLength={120} value={form.name} onChangeText={(name) => setForm({ ...form, name })} style={styles.input} />
        <Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Fan email" autoComplete="email" autoCapitalize="none" keyboardType="email-address" editable={!form.id} maxLength={254} value={form.email} onChangeText={(email) => setForm({ ...form, email })} style={styles.input} />
        <Text style={styles.label}>Choose access</Text>{FAN_ACCESS.map((item) => <View style={styles.permission} key={item.key}><ParentIcon iconKey={item.icon} color={tokens.accentText} size={26} /><View style={styles.copy}><Text style={styles.label}>{item.label}</Text><Text style={styles.helper}>{item.description}</Text></View><FanSwitch accessibilityLabel={item.label} disabled={item.key === 'resources' && !form.permissions.development} value={form.permissions[item.key]} onValueChange={(value) => setForm({ ...form, permissions: normalizeFanPermissions({ ...form.permissions, [item.key]: value }) })} /></View>)}
        {form.id && state.connections.some(connection => connection.id === form.id && connection.status === 'active' && connection.relationship_type !== 'player') ? <Action label="Make this the Player account" disabled={busy} onPress={() => setConvertAccount(form)} /> : null}
        <View style={styles.actions}>{form.id ? <Action label="Review changes" onPress={() => review('edit')} /> : <><Action icon="fan.email" label="Email" onPress={() => review('email')} disabled={busy} /><Action icon="fan.qr" label="QR code" onPress={() => review('qr')} disabled={busy} /><Action icon="fan.share" label="Share link" onPress={() => review('share')} disabled={busy} /></>}<Action label="Cancel" onPress={() => setForm(null)} /></View>
      </View> : null}
      {ready ? <View><Text style={{ color: tokens.textPrimary }}>Invitation ready for {ready.name} ({ready.email}). Expires {formatParentProductDateTime(ready.expires_at, { year: 'numeric' })}.</Text>{ready.mode === 'qr' ? <Qr value={ready.url} /> : null}<View style={styles.actions}><Action icon="fan.share" label="Share invitation" onPress={() => Share.share({ message: ready.url })} /><Action icon="fan.email" label="Send email" onPress={() => run(() => request({ action: 'send_invitation', connectionId: ready.id }))} /></View></View> : null}
      <View style={styles.fansHeading}><View style={styles.row}><Text accessibilityRole="header" style={[styles.heading, { marginTop: 0, flex: 1, fontSize: 22, fontWeight: '800' }]}>Your player's Fans</Text><Text accessibilityLabel={`${ownedFans.length} accounts and invitations`} style={styles.fanCount}>{ownedFans.length}</Text></View><Text style={styles.helper}>Manage sharing for {parent?.playerName}.</Text></View>
      <View style={styles.ownerFanList}>{ownedFans.map(c => <OwnedFanRow key={c.id} connection={c} busy={busy} onEdit={() => begin(c)} onRemove={() => remove(c, false)} onRenew={mode => reopenInvitation(c, mode)} onDelete={() => deleteInvitation(c)} />)}</View>
      {!state.loading && !ownedFans.length ? <Text style={styles.helper}>No Fan accounts for this player yet.</Text> : null}
    </> : null}
    <View accessibilityLabel="Players you follow">{state.connections.filter((c) => !c.is_owner && c.status === 'active').map((c) => <FansTheme.Provider key={c.id} value={fanBrandTheme(c, displayMode).tokens}><FanPlayerCard connection={c} mode={displayMode} busy={busy} SwitchControl={FanSwitch} onOpen={(action) => { setFormation(null); void state.open(c.id, action) }} onNotifications={(value) => run(() => state.manage(c.id, value ? 'notifications_on' : 'notifications_off'))} /></FansTheme.Provider>)}</View>
    {!parents.length && !state.loading && !state.connections.some(c => !c.is_owner && c.status === 'active') ? <Text style={styles.helper}>You are not following any players yet. Open a Fan invitation to get started.</Text> : null}


    <Modal visible={Boolean(convertAccount)} transparent animationType="fade" onRequestClose={() => setConvertAccount(null)}><View style={styles.overlay}><View style={styles.modal}><Text accessibilityRole="header" style={styles.heading}>Make this the Player account?</Text><Text style={styles.helper}>{convertAccount?.name} will be able to see this player's current attendance. They cannot accept or decline invitations. Existing shared access is retained.</Text><Action label="Confirm Player account" disabled={busy} onPress={() => run(async () => { await rpc('set_fan_player_account', { connection_id_value: convertAccount.id, player_account_value: true }); await state.reload(); setConvertAccount(null); setForm(null) })} /><Action label="Cancel" disabled={busy} onPress={() => setConvertAccount(null)} /></View></View></Modal>
    {embedded && followed.length ? <Action icon="settings" label="Fan settings" onPress={() => showSection('settings')} /> : null}
    </>}
    <Modal visible={signOutConfirm} transparent animationType="fade" onRequestClose={() => { if (!busy) setSignOutConfirm(false) }}><View style={styles.overlay}><ScrollView style={{ flexGrow: 0, maxHeight: "90%", width: "100%", maxWidth: 480, alignSelf: "center" }} contentContainerStyle={styles.modal}><Text accessibilityRole="header" style={styles.heading}>Sign out?</Text><Text style={styles.helper}>You will need to sign in again to see your players.</Text>{state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}<Action label="Stay signed in" disabled={busy} onPress={() => setSignOutConfirm(false)} /><Action label="Confirm sign out" disabled={busy} onPress={() => run(async () => { state.clearView(); await signOut(); setSignOutConfirm(false) })} /></ScrollView></View></Modal>
    <Modal visible={joining} transparent animationType="fade" onRequestClose={() => setJoining(false)}><View style={styles.overlay}><View style={styles.modal}><Text accessibilityRole="header" style={styles.heading}>Open a Fan invitation</Text><Text style={styles.helper}>To follow a player, open the Fan invitation link or scan the QR code shared with you. You can paste the invitation link below.</Text><TextInput accessibilityLabel="Invitation link" autoCapitalize="none" autoCorrect={false} value={invitationLink} onChangeText={setInvitationLink} placeholder="https://parent.footballplayer.online/fan-invite/..." placeholderTextColor={tokens.textSecondary} style={styles.input} /><Action label="Open invitation" disabled={!/^https:\/\/parent\.footballplayer\.online\/fan-invite\/[A-Za-z0-9_-]+\/?$/.test(invitationLink.trim())} onPress={() => run(async () => { await Linking.openURL(invitationLink.trim()); setJoining(false) })} /><Action label="Cancel" onPress={() => setJoining(false)} /></View></View></Modal>
    <Modal visible={Boolean(confirm)} transparent animationType="fade" onRequestClose={() => { if (!busy) setConfirm(null) }}>
      <View style={styles.overlay}><ScrollView contentContainerStyle={styles.modal}><Text accessibilityRole="header" style={styles.heading}>Confirm Fan access</Text>{confirm ? <><Text style={{ color: tokens.textPrimary }}>{confirm.id ? 'You are updating access for' : 'You are inviting'} {confirm.name} ({confirm.email}) to follow {confirm.child}.</Text>{fanAccessSummary(confirm.permissions).map((line) => <Text style={styles.permissionText} key={line}>{line}</Text>)}<Text style={{ color: tokens.textPrimary }}>This person cannot invite others, use parent chat, respond to attendance or change your player's information. Either of you can end this access.</Text></> : null}<View style={styles.actions}><Action label="Go back" disabled={busy} onPress={() => setConfirm(null)} /><Action label={confirm?.id ? 'Confirm changes' : 'Confirm invitation'} disabled={busy} onPress={complete} /></View></ScrollView></View>
    </Modal>
  </View></FansTheme.Provider>
  return embedded ? content : <SafeAreaView style={styles.safe}><ScrollView ref={localScrollRef} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">{content}</ScrollView><View accessibilityRole="tablist" style={styles.navigation}>{[{ key: 'home', label: 'Home', icon: 'home' }, { key: 'more', label: 'More', icon: 'more-horiz' }].map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: item.key === 'more' ? section !== 'home' : section === 'home' }} onPress={() => showSection(item.key)} style={styles.navItem}><ParentIcon iconKey={item.icon} color={(item.key === 'more' ? section !== 'home' : section === 'home') ? tokens.accentText : tokens.textSecondary} size={24} /><Text style={{ color: (item.key === 'more' ? section !== 'home' : section === 'home') ? tokens.accentText : tokens.textSecondary, fontSize: 12, fontWeight: '700' }}>{item.label}</Text></Pressable>)}</View></SafeAreaView>
}
function createStyles(tokens) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.portalSurface }, navigation: { flexDirection: 'row', borderTopWidth: 1, borderColor: tokens.border, backgroundColor: tokens.portalSurface }, navItem: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4 }, account: { marginTop: 24, paddingTop: 8, borderTopWidth: 1, borderColor: tokens.border }, container: { flexGrow: 1, backgroundColor: tokens.portalBackground, padding: 18, gap: 12 }, title: { fontSize: 26, fontWeight: '800', color: tokens.textPrimary }, heading: { fontSize: 20, fontWeight: '700', marginTop: 16, color: tokens.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, copy: { flex: 1, minWidth: 0 }, helper: { color: tokens.textSecondary, fontSize: 14, lineHeight: 20 }, label: { color: tokens.textPrimary, fontWeight: '700', fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, action: { minHeight: 46, paddingVertical: 10, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, actionLabel: { color: tokens.accentText, fontWeight: '700' },
  primaryAction: { minHeight: 54, justifyContent: 'center', paddingHorizontal: 18, marginVertical: 8, borderRadius: 10, backgroundColor: tokens.buttonPrimary }, primaryActionLabel: { fontSize: 17, color: tokens.accentForeground },
  compactAction: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 0, gap: 7, borderRadius: 9 },
  playersHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ownerPlayerList: { borderRadius: 6, overflow: 'hidden', backgroundColor: tokens.portalSurface }, ownerPlayer: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: mixThemeColor(tokens.border, tokens.portalSurface, 0.65) }, playerName: { flexShrink: 1, color: tokens.textPrimary, fontSize: 14, fontWeight: '700' }, selectedBadge: { color: tokens.accentText, backgroundColor: tokens.accentSoft, fontSize: 12, fontWeight: '600', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  fansHeading: { gap: 3, marginTop: 8 }, fanCount: { color: tokens.textPrimary, backgroundColor: mixThemeColor(tokens.border, tokens.portalSurface, 0.65), minWidth: 27, textAlign: 'center', borderRadius: 14, fontSize: 13, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 8 },
  ownerFanList: { backgroundColor: tokens.portalSurface }, ownerFan: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: mixThemeColor(tokens.border, tokens.portalSurface, 0.65) }, ownerFanRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingLeft: 8, gap: 4 }, fanIdentity: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 }, fanName: { color: tokens.textPrimary, fontSize: 14, lineHeight: 18, fontWeight: '700' }, fanEmail: { color: tokens.textSecondary, fontSize: 12, lineHeight: 16 }, fanStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 3 }, fanStatusText: { color: tokens.textSecondary, fontSize: 12, lineHeight: 16 }, fanIconActions: { flexDirection: 'row', alignItems: 'center' }, fanIconAction: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, fanDetails: { gap: 6, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: tokens.surfaceRaised },
  input: { minHeight: 48, borderWidth: 1, borderColor: tokens.border, borderRadius: 8, padding: 12, marginVertical: 8, color: tokens.textPrimary }, permission: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: tokens.border },
  person: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: tokens.border, gap: 6 }, error: { color: tokens.danger }, overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 }, modal: { backgroundColor: tokens.portalSurface, padding: 22, gap: 16, borderRadius: 12 }, permissionText: { fontWeight: '600', color: tokens.textPrimary },
}) }
