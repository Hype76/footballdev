import { Text, View } from 'react-native'
import { buildParentCalendarEvents } from '../../mobile-core/src/parentCalendarCore'
import { upcomingFanSchedule } from '../../../src/lib/fan-schedule'
import { normalizeParentMatchDay } from './parentPortalData'
import { CalendarScreen, DevelopmentScreen, MatchdayScreen, ResourcesScreen } from './ParentPortalScreens'
import { getParentGoogleCalendarUrl } from './parentExperience'
import { isFanGameDayMatch } from '../../../src/lib/fan-game-day'
import { fanBrandingLink } from '../../../src/lib/fan-branding'
import { FanAttendanceScreen } from './FanAttendanceScreen'
import { PlayerStatsScreen } from './PlayerStatsScreen'

export function FanContent({ suppressParentFormation = false, connection, view, content, loading = false, formation, matchdayPolicy, onCloseFormation, onOpenResource, onOpenLink, onOpen, themeTokens }) {
  const link = { ...fanBrandingLink(connection, matchdayPolicy), playerName: connection?.player_name, teamName: connection?.team_name }
  const resource = (items) => ({ items, loading, error: '' })
  const addToCalendar = (item) => onOpenLink(getParentGoogleCalendarUrl(item))
  if (view.action === 'attendance') return <FanAttendanceScreen items={content.attendance || []} themeTokens={themeTokens} />
  if (view.action === 'stats' && connection?.relationship_type === 'player') return <PlayerStatsScreen connection={connection} stats={content.stats} themeTokens={themeTokens} />
  if (view.action === 'schedule') {
    const canEventResources = connection?.relationship_type === 'player' && connection.permissions?.schedule
      && connection.permissions?.resources && connection.permissions?.development
    const calendarEvents = upcomingFanSchedule(content.schedule || []).map((item) => ({
      id: item.id, title: item.title, selectedPlayerNames: connection?.relationship_type === 'player' ? item.selected_player_names : undefined, eventType: item.event_type || 'event', status: item.status,
      startsAt: item.starts_at || (item.time ? `${item.date}T${item.time}` : item.date),
      endsAt: item.ends_at || (item.end_time ? `${item.date}T${item.end_time}` : ''), location: item.location, resources: canEventResources ? item.resources || [] : [],
    }))
    const attachments = calendarEvents.flatMap(event => event.resources)
    if (!suppressParentFormation && formation && attachments.some(item => item.id === formation.resourceId)) {
      return <ResourcesScreen suppressParentFormation={suppressParentFormation} resource={resource(attachments)} formationBoard={formation} formationBackLabel="Back to Calendar" onCloseFormation={onCloseFormation} onOpen={onOpenResource} themeTokens={themeTokens} />
    }
    return <CalendarScreen upcomingOnly link={link} resource={resource(buildParentCalendarEvents({ calendarEvents }))} onAddToCalendar={addToCalendar} onOpenLink={onOpenLink} onOpenResource={(_, attachment) => onOpenResource(attachment)} themeTokens={themeTokens} />
  }
  if (view.action === 'matches') {
    const isPlayer = connection?.relationship_type === 'player'
    const matches = (content.matches || []).filter((item) => isFanGameDayMatch(item) || (isPlayer && ['scheduled', 'scorer_request'].includes(item.status))).map((item) => ({ ...normalizeParentMatchDay({ ...item, team_name: connection?.team_name, club_name: item.club_name || connection?.club_name, events: view.matchId === item.id ? content.events || [] : [], is_scorer: false, isScorer: false, request_scorer: false }), isFanView: true, canViewSelectedSquad: isPlayer }))
    const live = matches.filter((item) => isFanGameDayMatch(item) && item.status !== 'full_time')
    const upcoming = isPlayer
      ? matches.filter((item) => ['scheduled', 'scorer_request'].includes(item.status)).sort((a, b) => Date.parse(a.matchDate) - Date.parse(b.matchDate))
      : []
    const viewerGroups = {
      upcoming: [...live, ...upcoming],
      recent: matches.filter((item) => item.status === 'full_time').sort((a, b) => Date.parse(b.matchDate) - Date.parse(a.matchDate)),
    }
    return <MatchdayScreen
      clubKits={content.clubKits || {}}
      link={link}
      onAddToCalendar={addToCalendar}
      onBack={() => onOpen('matches')}
      onOpen={(item) => onOpen('matches', { matchId: item.id })}
      onOpenLink={onOpenLink}
      resource={resource(matches)}
      selectedMatch={matches.find((item) => item.id === view.matchId)}
      suppressParentFormation={suppressParentFormation}
      themeTokens={themeTokens}
      viewerGroups={viewerGroups}
      viewerKind={isPlayer ? 'player' : 'fan'}
    />
  }
  if (view.action === 'development') return <DevelopmentScreen resource={resource(content.reports || [])} themeTokens={themeTokens} />
  if (view.action === 'resources') return <ResourcesScreen suppressParentFormation={suppressParentFormation} resource={resource(content.resources || [])} formationBoard={formation && content.resources?.some((item) => item.id === formation.resourceId) ? formation : null} onCloseFormation={onCloseFormation} onOpen={onOpenResource} themeTokens={themeTokens} />
  return <View style={{ gap: 16 }}><Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 26, fontWeight: '800' }}>Notifications</Text>{(content.notifications || []).map((item) => <View key={item.id}><Text style={{ color: themeTokens.textPrimary, fontWeight: '700' }}>{item.title}</Text><Text style={{ color: themeTokens.textSecondary }}>{item.body}</Text></View>)}{!content.notifications?.length ? <Text style={{ color: themeTokens.textSecondary }}>No shared notifications for this player.</Text> : null}</View>
}
