import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { getLinkedParentPlayerStats } from './parentPortalData'

function StatRow({ label, value, tokens }) {
  return <View style={{ borderBottomColor: tokens.border, borderBottomWidth: 1, flexDirection: 'row', minHeight: 52, alignItems: 'center', gap: 12 }}>
    <Text style={{ color: tokens.textPrimary, flex: 1, fontSize: 16 }}>{label}</Text>
    <Text style={{ color: tokens.textPrimary, fontSize: 18, fontWeight: '700' }}>{value}</Text>
  </View>
}

export function PlayerStatsScreen({ connection, stats, themeTokens }) {
  const record = stats?.matches || {}
  const personal = stats?.personal || {}
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 25, fontWeight: '800' }}>Stats</Text>
    <Text style={{ color: themeTokens.textSecondary }}>{connection?.player_name || 'Player'} | {stats?.period || 'Last 12 months'}</Text>
    <Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 19, fontWeight: '700', marginTop: 10 }}>Team matches</Text>
    <StatRow label="Won" value={record.won ?? 0} tokens={themeTokens} />
    <StatRow label="Lost" value={record.lost ?? 0} tokens={themeTokens} />
    <StatRow label="Drawn" value={record.drawn ?? 0} tokens={themeTokens} />
    <Text accessibilityRole="header" style={{ color: themeTokens.textPrimary, fontSize: 19, fontWeight: '700', marginTop: 14 }}>Player stats</Text>
    <StatRow label="Matches selected" value={personal.matches ?? 0} tokens={themeTokens} />
    {personal.playingTimeMatches > 0 ? <StatRow label={`Recorded playing time (${personal.playingTimeMatches} matches)`} value={`${personal.playingMinutes ?? 0} min`} tokens={themeTokens} /> : null}
    <StatRow label="Goals" value={personal.goals ?? 0} tokens={themeTokens} />
    <StatRow label="Assists" value={personal.assists ?? 0} tokens={themeTokens} />
    <StatRow label="Player of the Match (POM)" value={personal.playerOfTheMatch ?? 0} tokens={themeTokens} />
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
