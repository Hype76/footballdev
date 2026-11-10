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
  if (singleLine) {
    return <View accessibilityLabel={`${parts.firstTeam} versus ${parts.secondTeam}`} style={{ gap: 3, minWidth: 0 }}>
      {[[parts.firstTeam, firstLogo], [parts.secondTeam, secondLogo]].map(([name, logo], index) => (
        <View key={index} style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
          <TeamLogo key={logo} name={name} logoUrl={logo} size={size} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={[textStyle, { flex: 1, minWidth: 0 }]}>{name}</Text>
        </View>
      ))}
    </View>
  }
  return <View accessibilityRole={header ? 'header' : undefined} accessibilityLabel={header ? `${parts.firstTeam} v ${parts.secondTeam}` : `${parts.firstTeam} versus ${parts.secondTeam}`} style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 5 : 8, minWidth: 0 }}>
    <TeamLogo key={`first:${firstLogo}`} name={parts.firstTeam} logoUrl={firstLogo} size={size} />
    <Text adjustsFontSizeToFit ellipsizeMode="tail" minimumFontScale={0.6} numberOfLines={parts.firstTeam.includes(' ') ? 2 : 1} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'left' }]}>{parts.firstTeam}</Text>
    <Text style={textStyle}>v</Text>
    <Text adjustsFontSizeToFit ellipsizeMode="tail" minimumFontScale={0.6} numberOfLines={parts.secondTeam.includes(' ') ? 2 : 1} style={[textStyle, { flex: 1, minWidth: 0, textAlign: 'right' }]}>{parts.secondTeam}</Text>
    <TeamLogo key={`second:${secondLogo}`} name={parts.secondTeam} logoUrl={secondLogo} size={size} />
  </View>
}
