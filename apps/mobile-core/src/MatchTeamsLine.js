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

export function MatchTeamsLine({ match, clubLogoUrl = '', textStyle, compact = false, header = false, singleLine = false }) {
  const parts = getMatchDayDisplayParts(match)
  const clubIsHome = String(match?.homeAway ?? match?.home_away ?? '').trim().toLowerCase() !== 'away'
  const size = singleLine ? 16 : compact ? 20 : 28
  const firstLogo = clubIsHome ? clubLogoUrl : ''
  const secondLogo = clubIsHome ? '' : clubLogoUrl
  return <View accessibilityRole={header ? 'header' : undefined} accessibilityLabel={header ? `${parts.firstTeam} v ${parts.secondTeam}` : `${parts.firstTeam} versus ${parts.secondTeam}`} style={{ flexDirection: 'row', alignItems: 'center', gap: singleLine ? 4 : compact ? 5 : 8, minWidth: 0 }}>
    <TeamLogo key={`first:${firstLogo}`} name={parts.firstTeam} logoUrl={firstLogo} size={size} />
    <Text adjustsFontSizeToFit ellipsizeMode="tail" minimumFontScale={0.6} numberOfLines={singleLine || !parts.firstTeam.includes(' ') ? 1 : 2} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'left' }]}>{parts.firstTeam}</Text>
    <Text style={textStyle}>v</Text>
    <Text adjustsFontSizeToFit ellipsizeMode="tail" minimumFontScale={0.6} numberOfLines={singleLine || !parts.secondTeam.includes(' ') ? 1 : 2} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'right' }]}>{parts.secondTeam}</Text>
    <TeamLogo key={`second:${secondLogo}`} name={parts.secondTeam} logoUrl={secondLogo} size={size} />
  </View>
}
