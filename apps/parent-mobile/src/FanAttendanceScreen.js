import { useState } from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import { fanAttendanceResponse, fanAttendanceStart, groupFanAttendance } from '../../../src/lib/fan-attendance'
import { formatParentProductDateTime } from '../../mobile-core/src/parentDateTimeCore'
import ParentIcon from './ParentIcon'

export function FanAttendanceScreen({ items = [], themeTokens: tokens, now }) {
  const [tab, setTab] = useState('upcoming')
  const [showAll, setShowAll] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const { width } = useWindowDimensions()
  const groups = groupFanAttendance(items, now)
  const list = groups[tab]
  const visible = showAll ? list : list.slice(0, 4)
  const text = { color: tokens.textSecondary, fontSize: 16, lineHeight: 23 }
  const heading = { color: tokens.textPrimary, fontSize: 21, fontWeight: '800' }
  const action = { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }
  const Status = ({ response }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 132 }}>
    <ParentIcon iconKey={response.icon} size={21} color={tokens[response.tone]} />
    <Text style={{ color: tokens[response.tone], fontSize: 14, fontWeight: '700', flexShrink: 1 }}>{response.label}</Text>
  </View>
  const row = item => {
    const response = fanAttendanceResponse(item.response)
    const match = item.event_type === 'match_day'
    const kind = match ? ({ home: 'Home', away: 'Away', neutral: 'Neutral venue' })[item.home_away] || 'Match day' : item.event_type === 'training' ? 'Training' : 'Event'
    const expanded = expandedId === item.id
    return <View key={item.id} style={{ borderBottomWidth: 1, borderBottomColor: tokens.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${response.label}, ${expanded ? 'hide' : 'show'} details`} accessibilityState={{ expanded }} onPress={() => setExpandedId(expanded ? null : item.id)} style={[action, { paddingVertical: 15 }]}>
        <ParentIcon iconKey={match ? 'parent.match' : item.event_type === 'training' ? 'parent.training' : 'action.calendar'} size={30} color={tokens.textPrimary} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: tokens.textPrimary, fontSize: 17, fontWeight: '800' }}>{item.title}</Text>
          <Text style={text}>{formatParentProductDateTime(fanAttendanceStart(item), { weekday: 'short' })}</Text>
          <Text style={text}>{kind}</Text>
          {width < 420 ? <Status response={response} /> : null}
        </View>
        {width >= 420 ? <Status response={response} /> : null}
        <ParentIcon iconKey={expanded ? 'section.collapse' : 'action.open'} size={24} color={tokens.accentText} />
      </Pressable>
      {expanded ? <View style={{ paddingBottom: 16, gap: 6 }}>
        <Text style={text}>{formatParentProductDateTime(fanAttendanceStart(item), { weekday: 'long', year: 'numeric' })}</Text>
        <Text style={text}>{item.location || 'Location to be confirmed'}</Text>
        <Text style={text}>Your parent manages replies to invitations.</Text>
      </View> : null}
    </View>
  }
  return <View style={{ gap: 20 }}>
    <Text accessibilityRole="header" style={{ ...heading, fontSize: 28 }}>My attendance</Text>
    <Text style={text}>Your current attendance responses. Your parent manages replies to invitations.</Text>
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: tokens.border }}>
      {['upcoming', 'past'].map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => { setTab(value); setShowAll(false); setExpandedId(null) }} style={{ minHeight: 48, paddingHorizontal: 20, justifyContent: 'center', borderBottomWidth: tab === value ? 3 : 0, borderBottomColor: tokens.accentText }}>
        <Text style={{ color: tab === value ? tokens.accentText : tokens.textSecondary, fontSize: 18, fontWeight: '800' }}>{value === 'upcoming' ? 'Upcoming' : 'Past'}</Text>
      </Pressable>)}
    </View>
    {tab === 'upcoming' && visible.length ? <View style={{ gap: 6 }}><Text accessibilityRole="header" style={heading}>Next event</Text>{row(visible[0])}</View> : null}
    {(tab === 'past' ? visible.length > 0 : visible.length > 1) ? <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={heading}>{tab === 'past' ? 'Past events' : 'Upcoming'}</Text>
      {(tab === 'past' ? visible : visible.slice(1)).map(row)}
    </View> : null}
    {!list.length ? <Text style={text}>{tab === 'past' ? 'No past attendance responses in the last 90 days.' : 'No upcoming attendance requests.'}</Text> : null}
    {list.length > 4 ? <Pressable accessibilityRole="button" onPress={() => setShowAll(!showAll)} style={action}>
      <ParentIcon iconKey="action.calendar" size={26} color={tokens.accentText} />
      <Text style={{ color: tokens.accentText, fontSize: 17, fontWeight: '800', flex: 1 }}>{showAll ? 'Show fewer events' : `View all ${tab} events`}</Text>
      <ParentIcon iconKey={showAll ? 'section.collapse' : 'action.open'} size={24} color={tokens.accentText} />
    </Pressable> : null}
    <Text style={text}>{tab === 'past' ? 'Past responses from the last 90 days are shown.' : !showAll && list.length > 4 ? 'Only the next few events are shown. Tap above to see all shared upcoming events.' : 'These are the upcoming events shared with you.'}</Text>
  </View>
}
