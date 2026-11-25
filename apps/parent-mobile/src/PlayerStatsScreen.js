import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { getLinkedParentPlayerStats } from './parentPortalData'
import ParentIcon from './ParentIcon'

const teamMatchFilters = [
  { key: 'all', label: 'All' },
  { key: 'cup', label: 'Cup' },
  { key: 'league', label: 'League' },
  { key: 'friendly', label: 'Friendlies' },
]

function StatRow({ label, value, tokens }) {
  return <View style={{ borderBottomColor: tokens.border, borderBottomWidth: 1, flexDirection: 'row', minHeight: 45, alignItems: 'center', gap: 12 }}>
    <Text style={{ color: tokens.textPrimary, flex: 1, fontSize: 16 }}>{label}</Text>
    <Text style={{ color: tokens.textPrimary, fontSize: 18, fontWeight: '700' }}>{value}</Text>
  </View>
}

export function PlayerStatsScreen({ connection, stats, themeTokens }) {
  const [fixtureType, setFixtureType] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const breakdown = stats?.matchesByFixtureType
  const filter = breakdown ? teamMatchFilters.find(option => option.key === fixtureType) : teamMatchFilters[0]
  const record = (filter.key === 'all' ? stats?.matches : breakdown[filter.key]) || {}
  const personal = stats?.personal || {}
  const groupTitle = { color: themeTokens.textPrimary, fontSize: 18, fontWeight: '800', paddingVertical: 6 }
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 25, fontWeight: '800' }}>Stats</Text>
    <Text style={{ color: themeTokens.textSecondary }}>{connection?.player_name || 'Player'} | {stats?.period || 'Last 12 months'}</Text>
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text accessibilityRole="header" style={groupTitle}>Team matches</Text>
        {breakdown ? <Pressable accessibilityRole="button" accessibilityLabel={`Team matches filter, ${filter.label}`}
          accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters(value => !value)}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
          <Text style={{ color: themeTokens.accentText, fontWeight: '700' }}>{filter.label}</Text>
          <ParentIcon iconKey={showFilters ? 'section.collapse' : 'section.expand'} color={themeTokens.accentText} size={18} />
        </Pressable> : null}
      </View>
      {showFilters && breakdown ? <View accessibilityLabel="Team match types" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {teamMatchFilters.map(option => (
          <Pressable key={option.key} accessibilityRole="button" accessibilityState={{ selected: filter.key === option.key }}
            onPress={() => { setFixtureType(option.key); setShowFilters(false) }}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
            <Text style={{ color: themeTokens.accentText, fontWeight: filter.key === option.key ? '800' : '500' }}>{option.label}</Text>
          </Pressable>
        ))}
      </View> : null}
      <StatRow label="Won" value={record.won ?? 0} tokens={themeTokens} />
      <StatRow label="Lost" value={record.lost ?? 0} tokens={themeTokens} />
      <StatRow label="Drawn" value={record.drawn ?? 0} tokens={themeTokens} />
    </View>
    <View>
      <Text accessibilityRole="header" style={groupTitle}>Player stats</Text>
      <StatRow label="Matches selected" value={personal.matches ?? 0} tokens={themeTokens} />
      {personal.playingTimeMatches > 0 ? <StatRow label={`Recorded playing time (${personal.playingTimeMatches} matches)`} value={`${personal.playingMinutes ?? 0} min`} tokens={themeTokens} /> : null}
      <StatRow label="Goals" value={personal.goals ?? 0} tokens={themeTokens} />
      <StatRow label="Assists" value={personal.assists ?? 0} tokens={themeTokens} />
      <StatRow label="Player of the Match (POM)" value={personal.playerOfTheMatch ?? 0} tokens={themeTokens} />
    </View>
  </View>
}

export function LinkedParentPlayerStatsScreen({ link, isOffline, themeTokens }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (isOffline) return undefined
    let active = true
    getLinkedParentPlayerStats(link)
      .then(value => { if (active) setStats(value) })
      .catch(() => { if (active) setError('Player stats could not be loaded.') })
    return () => { active = false }
  }, [attempt, isOffline, link])
  if (!isOffline && stats) return <PlayerStatsScreen connection={{ player_name: link.playerName }} stats={stats} themeTokens={themeTokens} />
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 25, fontWeight: '800' }}>Player stats</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: themeTokens.textSecondary }}>{isOffline ? 'Reconnect to view player stats.' : error || 'Loading player stats...'}</Text>
    {error && !isOffline ? <Pressable accessibilityRole="button" onPress={() => { setError(''); setAttempt(value => value + 1) }} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: themeTokens.textPrimary, fontWeight: '700' }}>Try again</Text>
    </Pressable> : null}
  </View>
}
