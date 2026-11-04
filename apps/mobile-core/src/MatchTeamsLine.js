import { useState } from 'react'
import { Image, Text, View } from 'react-native'
import { getMatchDayDisplayParts } from '../../../src/lib/matchday-display.js'

const fallbackLogo = require('../assets/football-player-logo.png')

function TeamLogo({ name, logoUrl, size }) {
  const [failedUrl, setFailedUrl] = useState('')
  const remote = typeof logoUrl === 'string' && logoUrl.startsWith('https://') && failedUrl !== logoUrl
  return <Image
    accessibilityLabel={remote ? `${name} badge` : `${name} Football Player fallback badge`}
    onError={remote ? () => setFailedUrl(logoUrl) : undefined}
    resizeMode="contain"
    source={remote ? { uri: logoUrl } : fallbackLogo}
    style={{ width: size, height: size, opacity: remote ? 1 : 0.55, tintColor: remote ? undefined : '#8a9494' }}
  />
}

export function MatchTeamsLine({ match, clubLogoUrl = '', textStyle, compact = false, header = false }) {
  const parts = getMatchDayDisplayParts(match)
  const clubIsHome = String(match?.homeAway ?? match?.home_away ?? '').trim().toLowerCase() !== 'away'
  const size = compact ? 20 : 28
  const firstLogo = clubIsHome ? clubLogoUrl : ''
  const secondLogo = clubIsHome ? '' : clubLogoUrl
  return <View accessibilityRole={header ? 'header' : undefined} accessibilityLabel={header ? `${parts.firstTeam} v ${parts.secondTeam}` : `${parts.firstTeam} versus ${parts.secondTeam}`} style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 5 : 8, minWidth: 0 }}>
    <TeamLogo key={`first:${firstLogo}`} name={parts.firstTeam} logoUrl={firstLogo} size={size} />
    <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={parts.firstTeam.includes(' ') ? 2 : 1} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'left' }]}>{parts.firstTeam}</Text>
    <Text style={textStyle}>v</Text>
    <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={parts.secondTeam.includes(' ') ? 2 : 1} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'right' }]}>{parts.secondTeam}</Text>
    <TeamLogo key={`second:${secondLogo}`} name={parts.secondTeam} logoUrl={secondLogo} size={size} />
  </View>
}
