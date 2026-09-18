import { Pressable, Text, View } from 'react-native'
import { buildParentCalendarEvents } from '../../mobile-core/src/parentCalendarCore'
import { upcomingFanSchedule } from '../../../src/lib/fan-schedule'
import { normalizeParentMatchDay } from './parentPortalData'
import { CalendarScreen, DevelopmentScreen, MatchdayScreen, ResourcesScreen } from './ParentPortalScreens'
import { getParentGoogleCalendarUrl } from './parentExperience'
import { formatParentProductDateTime } from '../../mobile-core/src/parentDateTimeCore'
import { isFanGameDayMatch } from '../../../src/lib/fan-game-day'
import { getMatchDayDisplayName } from '../../../src/lib/matchday-display'
import ParentIcon from './ParentIcon'
import { FanAttendanceScreen } from './FanAttendanceScreen'

export function FanContent({ connection, view, content, formation, onCloseFormation, onOpenResource, onOpenLink, onOpen, themeTokens }) {
  const link = { playerName: connection?.player_name, teamName: connection?.team_name, clubName: connection?.club_name }
  const resource = (items) => ({ items, loading: false, error: '' })
  const addToCalendar = (item) => onOpenLink(getParentGoogleCalendarUrl(item))
  if (view.action === 'attendance') return <FanAttendanceScreen items={content.attendance || []} themeTokens={themeTokens} />
  if (view.action === 'schedule') {
    const calendarEvents = upcomingFanSchedule(content.schedule || []).map((item) => ({
      id: item.id, title: item.title, selectedPlayerNames: connection?.relationship_type === 'player' ? item.selected_player_names : undefined, eventType: item.event_type || 'event', status: item.status,
      startsAt: item.starts_at || (item.time ? `${item.date}T${item.time}` : item.date),
      endsAt: item.ends_at || (item.end_time ? `${item.date}T${item.end_time}` : ''), location: item.location,
    }))
    return <CalendarScreen upcomingOnly link={link} resource={resource(buildParentCalendarEvents({ calendarEvents }))} onAddToCalendar={addToCalendar} onOpenLink={onOpenLink} themeTokens={themeTokens} />
  }
  if (view.action === 'matches') {
    const matches = (content.matches || []).filter(isFanGameDayMatch).map((item) => ({ ...normalizeParentMatchDay({ ...item, team_name: connection?.team_name, club_name: item.club_name || connection?.club_name, events: view.matchId === item.id ? content.events || [] : [], is_scorer: false, isScorer: false, request_scorer: false }), isFanView: true, canViewSelectedSquad: connection?.relationship_type === 'player' }))
    if (!view.matchId || !matches.some(item => item.id === view.matchId)) return <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 26, fontWeight: '800' }}>Game Day</Text>
      <Text style={{ color: themeTokens.textSecondary }}>Live matches and results shared for {connection?.player_name || 'your player'}.</Text>
      {[{ label: 'Live matches', items: matches.filter(item => item.status !== 'full_time') }, { label: 'Results', items: matches.filter(item => item.status === 'full_time') }].map(group => <View key={group.label} style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 20, fontWeight: '700' }}>{group.label}</Text>
        {!group.items.length ? <Text style={{ color: themeTokens.textSecondary }}>No shared {group.label.toLowerCase()}.</Text> : group.items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${getMatchDayDisplayName(item)}`} onPress={() => onOpen('matches', { matchId: item.id })} style={{ borderWidth: 1, borderColor: themeTokens.border, borderRadius: 12, padding: 16, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}><Text style={{ color: themeTokens.textPrimary, fontSize: 16, fontWeight: '700' }}>{getMatchDayDisplayName(item)}</Text><Text style={{ color: themeTokens.textSecondary }}>{formatParentProductDateTime(item.matchDate, { year: 'numeric' })}</Text><Text style={{ color: themeTokens.textPrimary, fontSize: 24, fontWeight: '800' }}>{item.homeScore ?? 0} - {item.awayScore ?? 0}</Text></View>
          <ParentIcon iconKey="action.open" color={themeTokens.accentText} size={24} />
        </Pressable>)}
      </View>)}
    </View>
    return <MatchdayScreen link={link} clubKits={content.clubKits || {}} resource={resource(matches)} selectedMatch={matches.find((item) => item.id === view.matchId)} onOpen={(item) => onOpen('matches', { matchId: item.id })} onBack={() => onOpen('matches')} onOpenLink={onOpenLink} onAddToCalendar={addToCalendar} themeTokens={themeTokens} />
  }
  if (view.action === 'development') return <DevelopmentScreen resource={resource(content.reports || [])} themeTokens={themeTokens} />
  if (view.action === 'resources') return <ResourcesScreen resource={resource(content.resources || [])} formationBoard={formation && content.resources?.some((item) => item.id === formation.resourceId) ? formation : null} onCloseFormation={onCloseFormation} onOpen={onOpenResource} themeTokens={themeTokens} />
  return <View style={{ gap: 16 }}><Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 26, fontWeight: '800' }}>Notifications</Text>{(content.notifications || []).map((item) => <View key={item.id}><Text style={{ color: themeTokens.textPrimary, fontWeight: '700' }}>{item.title}</Text><Text style={{ color: themeTokens.textSecondary }}>{item.body}</Text></View>)}{!content.notifications?.length ? <Text style={{ color: themeTokens.textSecondary }}>No shared notifications for this player.</Text> : null}</View>
}
