import { Text, View } from 'react-native'

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
    <StatRow label="Goals" value={personal.goals ?? 0} tokens={themeTokens} />
    <StatRow label="Assists" value={personal.assists ?? 0} tokens={themeTokens} />
    <StatRow label="Player of the Match" value={personal.playerOfTheMatch ?? 0} tokens={themeTokens} />
  </View>
}
