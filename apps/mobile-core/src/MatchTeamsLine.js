import { useState } from 'react'
import { Image, Text, View } from 'react-native'
import { getMatchDayDisplayParts } from '../../../src/lib/matchday-display.js'

const fallbackLogo = require('../assets/football-player-logo-grey.png')

function TeamLogo({ name, logoUrl, size }) {
  const [failedUrl, setFailedUrl] = useState('')
  const remote = typeof logoUrl === 'string' && logoUrl.startsWith('https://') && failedUrl !== logoUrl
  return <Image
    accessibilityLabel={remote ? `${name} badge` : `${name} Football Player fallback badge`}
    onError={remote ? () => setFailedUrl(logoUrl) : undefined}
    resizeMode="contain"
    source={remote ? { uri: logoUrl } : fallbackLogo}
    style={{ width: size, height: size, tintColor: remote ? undefined : '#8a9494' }}
  />
}

export function MatchTeamsLine({ match, clubLogoUrl = '', textStyle, compact = false, header = false, stacked = false }) {
  const parts = getMatchDayDisplayParts(match)
  const clubIsHome = String(match?.homeAway ?? match?.home_away ?? '').trim().toLowerCase() !== 'away'
  const size = compact ? 20 : 28
  const firstLogo = clubIsHome ? clubLogoUrl : ''
  const secondLogo = clubIsHome ? '' : clubLogoUrl
  if (stacked) return <View accessibilityLabel={`${parts.firstTeam} versus ${parts.secondTeam}`} style={{ gap: 2, minWidth: 0 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <TeamLogo key={`first:${firstLogo}`} name={parts.firstTeam} logoUrl={firstLogo} size={size} />
      <Text numberOfLines={2} style={[textStyle, { flex: 1, minWidth: 0 }]}>{parts.firstTeam}</Text>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <Text style={[textStyle, { width: size, textAlign: 'center' }]}>v</Text>
      <TeamLogo key={`second:${secondLogo}`} name={parts.secondTeam} logoUrl={secondLogo} size={size} />
      <Text numberOfLines={2} style={[textStyle, { flex: 1, minWidth: 0 }]}>{parts.secondTeam}</Text>
    </View>
  </View>
  return <View accessibilityRole={header ? 'header' : undefined} accessibilityLabel={header ? `${parts.firstTeam} v ${parts.secondTeam}` : `${parts.firstTeam} versus ${parts.secondTeam}`} style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 5 : 8, minWidth: 0 }}>
    <TeamLogo key={`first:${firstLogo}`} name={parts.firstTeam} logoUrl={firstLogo} size={size} />
    <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={parts.firstTeam.includes(' ') ? 2 : 1} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'left' }]}>{parts.firstTeam}</Text>
    <Text style={textStyle}>v</Text>
    <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={parts.secondTeam.includes(' ') ? 2 : 1} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'right' }]}>{parts.secondTeam}</Text>
    <TeamLogo key={`second:${secondLogo}`} name={parts.secondTeam} logoUrl={secondLogo} size={size} />
  </View>
}
