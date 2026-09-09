import { Text, View } from 'react-native'
import { buildParentCalendarEvents } from '../../mobile-core/src/parentCalendarCore'
import { upcomingFanSchedule } from '../../../src/lib/fan-schedule'
import { normalizeParentMatchDay } from './parentPortalData'
import { CalendarScreen, DevelopmentScreen, MatchdayScreen, ResourcesScreen } from './ParentPortalScreens'
import { getParentGoogleCalendarUrl } from './parentExperience'

export function FanContent({ connection, view, content, formation, onCloseFormation, onOpenResource, onOpenLink, onOpen, themeTokens }) {
  const link = { playerName: connection?.player_name, teamName: connection?.team_name }
  const resource = (items) => ({ items, loading: false, error: '' })
  const addToCalendar = (item) => onOpenLink(getParentGoogleCalendarUrl(item))
  if (view.action === 'schedule') {
    const calendarEvents = upcomingFanSchedule(content.schedule || []).map((item) => ({
      id: item.id, title: item.title, eventType: item.event_type || 'event', status: item.status,
      startsAt: item.starts_at || (item.time ? `${item.date}T${item.time}` : item.date),
      endsAt: item.ends_at || (item.end_time ? `${item.date}T${item.end_time}` : ''), location: item.location,
    }))
    return <CalendarScreen upcomingOnly link={link} resource={resource(buildParentCalendarEvents({ calendarEvents }))} onAddToCalendar={addToCalendar} onOpenLink={onOpenLink} themeTokens={themeTokens} />
  }
  if (view.action === 'matches') {
    const matches = (content.matches || []).map((item) => ({ ...normalizeParentMatchDay({ ...item, team_name: connection?.team_name, events: view.matchId === item.id ? content.events || [] : [], is_scorer: false, isScorer: false, request_scorer: false }), isFanView: true }))
    return <MatchdayScreen link={link} resource={resource(matches)} selectedMatch={matches.find((item) => item.id === view.matchId)} onOpen={(item) => onOpen('matches', { matchId: item.id })} onBack={() => onOpen('matches')} onOpenLink={onOpenLink} onAddToCalendar={addToCalendar} themeTokens={themeTokens} />
  }
  if (view.action === 'development') return <DevelopmentScreen resource={resource(content.reports || [])} themeTokens={themeTokens} />
  if (view.action === 'resources') return <ResourcesScreen resource={resource(content.resources || [])} formationBoard={formation && content.resources?.some((item) => item.id === formation.resourceId) ? formation : null} onCloseFormation={onCloseFormation} onOpen={onOpenResource} themeTokens={themeTokens} />
  return <View style={{ gap: 16 }}><Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 26, fontWeight: '800' }}>Notifications</Text>{(content.notifications || []).map((item) => <View key={item.id}><Text style={{ color: themeTokens.textPrimary, fontWeight: '700' }}>{item.title}</Text><Text style={{ color: themeTokens.textSecondary }}>{item.body}</Text></View>)}{!content.notifications?.length ? <Text style={{ color: themeTokens.textSecondary }}>No shared notifications for this child.</Text> : null}</View>
}
