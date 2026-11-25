import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { fanBrandingLink, fanBrandTheme } from '../../../src/lib/fan-branding'
import { canViewFanNotifications, getFanAccessForPlan, isFanAccessAllowedForPlan } from '../../../src/lib/fans'
import ParentIcon from './ParentIcon'
import { TeamLeagueLinkRow } from '../../mobile-core/src/TeamLeagueLink'
import { parentPlayerTeamLeagueScope } from '../../../src/lib/team-league-link'
import { supabase } from '../../mobile-core/src/supabase'

export function FanPlayerCard({ connection, matchdayPolicy, mode, busy, onOpen, onNotifications, SwitchControl, leagueUser, hideIdentity = false }) {
  const FanSwitch = SwitchControl
  const { width, fontScale } = useWindowDimensions()
  const tileWrapper = { width: width < 330 || fontScale > 1.3 ? '48%' : '31%' }
  const tokens = fanBrandTheme(connection, mode, matchdayPolicy, { polished: true }).tokens
  const brand = fanBrandingLink(connection, matchdayPolicy)
  const [failedLogo, setFailedLogo] = useState('')
  const border = tokens.border
  const access = [...getFanAccessForPlan(connection, matchdayPolicy).filter(item => connection.permissions[item.key]), ...(connection.relationship_type === 'player' && connection.permissions.schedule && isFanAccessAllowedForPlan(connection, 'attendance', matchdayPolicy) ? [{ key: 'attendance', label: 'Attendance', icon: 'action.calendar' }] : []), ...(connection.relationship_type === 'player' && connection.permissions.game_day && isFanAccessAllowedForPlan(connection, 'stats', matchdayPolicy) ? [{ key: 'stats', label: 'Stats', icon: 'coach.development' }] : [])]
  const order = ['schedule', 'game_day', 'attendance', 'stats', 'resources', 'development']
  access.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  const iconWell = [styles.iconWell, { backgroundColor: tokens.accentSoft }]
  const surface = { backgroundColor: tokens.portalSurface, borderColor: border, shadowColor: tokens.accentText }
  const open = item => { onOpen(item.key === 'game_day' ? 'matches' : item.key) }
  return <View style={styles.container}>
    {!hideIdentity ? <View style={[styles.card, surface]}><View style={[styles.club, { borderBottomColor: border }]}>
      {brand.clubLogoUrl && failedLogo !== brand.clubLogoUrl ? <Image accessibilityLabel={`${brand.clubName} logo`} source={{ uri: brand.clubLogoUrl }} onError={() => setFailedLogo(brand.clubLogoUrl)} resizeMode="contain" style={styles.crest} /> : <ParentIcon iconKey="shield" color={tokens.accentText} size={52} />}
      <View style={styles.copy}><Text style={[styles.clubName, { color: tokens.textPrimary }]}>{brand.clubName}</Text><Text style={[styles.subtitle, { color: tokens.textSecondary }]}>Following player</Text></View>
    </View>
    <View style={[styles.player, { borderBottomColor: border }]}>
      <ParentIcon iconKey="child" color={tokens.accentText} size={42} />
      <View style={styles.copy}><Text style={[styles.playerName, { color: tokens.textPrimary }]}>{connection.player_name}</Text><Text style={[styles.subtitle, { color: tokens.textSecondary }]}>{connection.team_name}</Text></View>
    </View></View> : null}
    <View style={styles.shortcuts}>
    {leagueUser ? <TeamLeagueLinkRow client={supabase} palette={tokens} tile
      scope={parentPlayerTeamLeagueScope(leagueUser, leagueUser.parentPortalLinks?.find(link => link.id === connection.id))}
      styles={{ tileWrapper, tile: styles.tile, tileIcon: iconWell, tileHeader: styles.tileHeader, cardTitle: [styles.shortcutLabel, { color: tokens.textPrimary }] }} /> : null}
      {access.map((item) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.key === 'stats' ? `View stats for ${connection.player_name}` : item.key === 'resources' ? 'Resources' : item.label} onPress={() => open(item)} style={[tileWrapper, styles.tile]}>
        <View style={styles.tileHeader}>
          <View style={iconWell}><ParentIcon iconKey={item.icon} color={tokens.accentText} size={23} /></View>
          <ParentIcon iconKey="action.open" color={tokens.accentText} size={16} />
        </View>
        <Text style={[styles.shortcutLabel, { color: tokens.textPrimary }]}>{item.key === 'resources' ? 'Resources' : item.label}</Text>
      </Pressable>)}
    </View>
    {canViewFanNotifications(connection, matchdayPolicy) ? <View style={[styles.notifications, { borderTopColor: border }]}>
      <View style={styles.notificationToggle}><ParentIcon iconKey="notifications" color={tokens.accentText} size={24} /><Text style={[styles.notificationLabel, { color: tokens.textPrimary }]}>{connection.relationship_type === 'player' ? 'Player notifications' : 'Game Day notifications'}</Text><FanSwitch inline accessibilityLabel={`${connection.relationship_type === 'player' ? 'Player' : 'Game Day'} notifications for ${connection.player_name}`} value={connection.notifications_enabled} disabled={busy} onValueChange={onNotifications} /></View>
      <View style={[styles.notificationActions, { borderTopColor: border }]}><Pressable accessibilityRole="button" accessibilityLabel="View notifications" onPress={() => onOpen('notifications')} style={styles.viewNotifications}><ParentIcon iconKey="visibility" color={tokens.accentText} size={24} /><Text style={[styles.notificationLabel, { color: tokens.textPrimary }]}>View notifications</Text><ParentIcon iconKey="action.open" color={tokens.accentText} size={18} /></Pressable></View>
    </View> : null}

  </View>
}

const styles = StyleSheet.create({
  container: { gap: 10, marginBottom: 8 },
  card: { borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, elevation: 2, marginBottom: 8, paddingHorizontal: 11, paddingVertical: 7, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 7 },
  iconWell: { alignItems: 'center', borderRadius: 11, height: 36, justifyContent: 'center', width: 36 },
  club: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  crest: { width: 58, height: 58 }, copy: { flex: 1, minWidth: 0, gap: 4 },
  clubName: { fontSize: 18, lineHeight: 24, fontWeight: '800' }, subtitle: { fontSize: 14, lineHeight: 19 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 }, playerName: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { minHeight: 94, padding: 8, gap: 6 },
  tileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shortcutLabel: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  notifications: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth }, notificationToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, notificationLabel: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' }, notificationActions: { borderTopWidth: StyleSheet.hairlineWidth }, viewNotifications: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
})
