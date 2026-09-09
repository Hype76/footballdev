import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { fanBrandingLink, fanBrandTheme } from '../../../src/lib/fan-branding'
import { FAN_ACCESS } from '../../../src/lib/fans'
import ParentIcon from './ParentIcon'

export function FanPlayerCard({ connection, mode, busy, onOpen, onNotifications, onEnableNotifications, onRemove, SwitchControl }) {
  const FanSwitch = SwitchControl
  const tokens = fanBrandTheme(connection, mode).tokens
  const brand = fanBrandingLink(connection)
  const [menuOpen, setMenuOpen] = useState('')
  const [failedLogo, setFailedLogo] = useState('')
  const { width, fontScale } = useWindowDimensions()
  const compact = width < 360 || fontScale > 1.3
  const wide = width >= 480 && fontScale <= 1.3
  const border = mode === 'dark' ? tokens.border : '#e0e4e9'
  const access = FAN_ACCESS.filter(item => connection.permissions[item.key])
  const colours = mode === 'dark'
    ? { schedule: '#4ade80', game_day: '#dbe7ee', development: '#ffb24d', resources: '#c3a3ff' }
    : { schedule: '#078539', game_day: '#293d4b', development: '#db7900', resources: '#53109b' }
  const open = item => { setMenuOpen(''); onOpen(item.key === 'game_day' ? 'matches' : item.key) }
  const menu = label => <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${connection.player_name}`} accessibilityState={{ expanded: menuOpen === label }} onPress={() => setMenuOpen(value => value === label ? '' : label)} style={styles.menuButton}><ParentIcon iconKey="more-horiz" color={tokens.textSecondary} size={26} /></Pressable>
  return <View style={[styles.card, { backgroundColor: tokens.portalSurface, borderColor: border, zIndex: menuOpen ? 10 : 0 }]}>
    <View style={[styles.club, { borderBottomColor: border }]}>
      {brand.clubLogoUrl && failedLogo !== brand.clubLogoUrl ? <Image accessibilityLabel={`${brand.clubName} logo`} source={{ uri: brand.clubLogoUrl }} onError={() => setFailedLogo(brand.clubLogoUrl)} resizeMode="contain" style={styles.crest} /> : <ParentIcon iconKey="shield" color={tokens.accentText} size={52} />}
      <View style={styles.copy}><Text style={[styles.clubName, { color: tokens.textPrimary }]}>{brand.clubName}</Text><Text style={[styles.subtitle, { color: tokens.textSecondary }]}>Your access</Text></View>
      {menu('Player options')}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${connection.player_name}`} disabled={!access.length} onPress={() => access[0] && open(access[0])} style={[styles.player, { borderBottomColor: border }]}>
      <ParentIcon iconKey="child" color={tokens.accentText} size={42} />
      <View style={styles.copy}><Text style={[styles.playerName, { color: tokens.textPrimary }]}>{connection.player_name}</Text><Text style={[styles.subtitle, { color: tokens.textSecondary }]}>{connection.team_name}</Text></View>
      <ParentIcon iconKey="action.open" color={tokens.textSecondary} size={25} />
    </Pressable>
    <View style={styles.shortcuts}>
      {access.map((item, index) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.key === 'resources' ? 'Resources' : item.label} onPress={() => open(item)} style={[styles.shortcut, { width: compact ? '50%' : `${100 / access.length}%`, borderLeftWidth: !compact && index > 0 ? 1 : 0, borderLeftColor: border }]}>
        <ParentIcon iconKey={item.icon} color={colours[item.key]} size={27} />
        <Text style={[styles.shortcutLabel, { color: tokens.textPrimary }]}>{item.key === 'resources' ? 'Resources' : item.label}</Text>
      </Pressable>)}
    </View>
    {connection.permissions.game_day ? <View style={[styles.notifications, { borderTopColor: border }, wide && { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
      <View style={styles.notificationToggle}><ParentIcon iconKey="notifications" color={tokens.accentText} size={24} /><Text style={[styles.notificationLabel, { color: tokens.textPrimary }]}>Game Day notifications</Text><FanSwitch inline accessibilityLabel={`Game Day notifications for ${connection.player_name}`} value={connection.notifications_enabled} disabled={busy} onValueChange={onNotifications} /></View>
      <View style={styles.notificationActions}><Pressable accessibilityRole="button" accessibilityLabel="View notifications" onPress={() => onOpen('notifications')} style={styles.viewNotifications}><ParentIcon iconKey="visibility" color={colours.game_day} size={24} /><Text style={[styles.notificationLabel, { color: tokens.textPrimary }]}>View notifications</Text></Pressable>{menu('More actions')}</View>
    </View> : null}
    {menuOpen ? <View style={[styles.accessMenu, { backgroundColor: tokens.surfaceRaised, borderColor: border }, menuOpen === 'Player options' && { top: 72, bottom: undefined }]}>{connection.permissions.game_day && menuOpen === 'Player options' ? <Pressable accessibilityRole="button" accessibilityLabel="Enable phone notifications" disabled={busy} onPress={() => { setMenuOpen(''); onEnableNotifications() }} style={styles.viewNotifications}><ParentIcon iconKey="notifications" color={tokens.textPrimary} size={24} /><Text style={{ color: tokens.textPrimary, fontWeight: '600' }}>Enable phone notifications</Text></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel="Remove my access" disabled={busy} onPress={() => { setMenuOpen(''); onRemove() }} style={styles.viewNotifications}><ParentIcon iconKey="fan.remove" color={tokens.textPrimary} size={24} /><Text style={{ color: tokens.textPrimary, fontWeight: '600' }}>Remove my access</Text></Pressable></View> : null}
  </View>
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 16 },
  club: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  crest: { width: 58, height: 58 }, copy: { flex: 1, minWidth: 0, gap: 4 },
  clubName: { fontSize: 20, lineHeight: 25, fontWeight: '800' }, subtitle: { fontSize: 14, lineHeight: 19 },
  menuButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  player: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 }, playerName: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 12 }, shortcut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, paddingHorizontal: 5 }, shortcutLabel: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontWeight: '500' },
  notifications: { borderTopWidth: 1, paddingTop: 10, paddingBottom: 4, gap: 4 }, notificationToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, notificationLabel: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontWeight: '500' }, notificationActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, viewNotifications: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  accessMenu: { position: 'absolute', right: 0, bottom: -42, zIndex: 10, elevation: 5, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
})
