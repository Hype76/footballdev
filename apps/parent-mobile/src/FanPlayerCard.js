import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { fanBrandingLink, fanBrandTheme } from '../../../src/lib/fan-branding'
import { FAN_ACCESS } from '../../../src/lib/fans'
import ParentIcon from './ParentIcon'

export function FanPlayerCard({ connection, mode, busy, onOpen, onNotifications, SwitchControl }) {
  const FanSwitch = SwitchControl
  const tokens = fanBrandTheme(connection, mode).tokens
  const brand = fanBrandingLink(connection)
  const [failedLogo, setFailedLogo] = useState('')
  const border = mode === 'dark' ? tokens.border : '#e0e4e9'
  const access = [...FAN_ACCESS.filter(item => connection.permissions[item.key]), ...(connection.relationship_type === 'player' && connection.permissions.schedule ? [{ key: 'attendance', label: 'Attendance', icon: 'action.calendar' }] : [])]
  const colours = mode === 'dark'
    ? { schedule: '#4ade80', game_day: '#dbe7ee', development: '#ffb24d', resources: '#c3a3ff' }
    : { schedule: '#078539', game_day: '#293d4b', development: '#db7900', resources: '#53109b' }
  const open = item => { onOpen(item.key === 'game_day' ? 'matches' : item.key) }
  return <View style={[styles.card, { backgroundColor: tokens.portalSurface, borderColor: border }]}>
    <View style={[styles.club, { borderBottomColor: border }]}>
      {brand.clubLogoUrl && failedLogo !== brand.clubLogoUrl ? <Image accessibilityLabel={`${brand.clubName} logo`} source={{ uri: brand.clubLogoUrl }} onError={() => setFailedLogo(brand.clubLogoUrl)} resizeMode="contain" style={styles.crest} /> : <ParentIcon iconKey="shield" color={tokens.accentText} size={52} />}
      <View style={styles.copy}><Text style={[styles.clubName, { color: tokens.textPrimary }]}>{brand.clubName}</Text><Text style={[styles.subtitle, { color: tokens.textSecondary }]}>Following player</Text></View>
    </View>
    <View style={[styles.player, { borderBottomColor: border }]}>
      <ParentIcon iconKey="child" color={tokens.accentText} size={42} />
      <View style={styles.copy}><Text style={[styles.playerName, { color: tokens.textPrimary }]}>{connection.player_name}</Text><Text style={[styles.subtitle, { color: tokens.textSecondary }]}>{connection.team_name}</Text></View>
    </View>
    <View style={styles.shortcuts}>
      {access.map((item) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.key === 'resources' ? 'Resources' : item.label} onPress={() => open(item)} style={[styles.shortcut, { backgroundColor: tokens.portalBackground, borderColor: border }]}>
        <ParentIcon iconKey={item.icon} color={colours[item.key] || tokens.accentText} size={27} />
        <Text style={[styles.shortcutLabel, { color: tokens.textPrimary }]}>{item.key === 'resources' ? 'Resources' : item.label}</Text><ParentIcon iconKey="action.open" color={tokens.textSecondary} size={18} />
      </Pressable>)}
    </View>
    {connection.permissions.game_day ? <View style={[styles.notifications, { borderTopColor: border }]}>
      <View style={styles.notificationToggle}><ParentIcon iconKey="notifications" color={tokens.accentText} size={24} /><Text style={[styles.notificationLabel, { color: tokens.textPrimary }]}>Game Day notifications</Text><FanSwitch inline accessibilityLabel={`Game Day notifications for ${connection.player_name}`} value={connection.notifications_enabled} disabled={busy} onValueChange={onNotifications} /></View>
      <View style={styles.notificationActions}><Pressable accessibilityRole="button" accessibilityLabel="View notifications" onPress={() => onOpen('notifications')} style={styles.viewNotifications}><ParentIcon iconKey="visibility" color={colours.game_day} size={24} /><Text style={[styles.notificationLabel, { color: tokens.textPrimary }]}>View notifications</Text></Pressable></View>
    </View> : null}

  </View>
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 16 },
  club: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  crest: { width: 58, height: 58 }, copy: { flex: 1, minWidth: 0, gap: 4 },
  clubName: { fontSize: 18, lineHeight: 24, fontWeight: '800' }, subtitle: { fontSize: 14, lineHeight: 19 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 }, playerName: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  shortcuts: { gap: 8, paddingVertical: 14 }, shortcut: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderRadius: 12 }, shortcutLabel: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  notifications: { borderTopWidth: 1, paddingTop: 10, paddingBottom: 4, gap: 4 }, notificationToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, notificationLabel: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' }, notificationActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, viewNotifications: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
})
