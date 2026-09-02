import { Image, Text, View } from 'react-native'
import { getAccessToken } from '../../mobile-core/src/supabase'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { requestGuestScorer } from '../../../src/lib/guest-scorer.js'
import { useGuestScorerManagement } from '../../../src/lib/use-guest-scorer-management.js'
async function request(body) {
  return requestGuestScorer(body, { token: await getAccessToken(), origin: getMobileRuntimeConfig('coach').apiBaseUrl })
}
export function CoachGuestScorer({ match, styles, buttonComponent, disabled = false }) {
  const Button = buttonComponent
  const { guest, busy, error, run } = useGuestScorerManagement(match.id, request)
  if (['full_time', 'cancelled', 'postponed'].includes(match.status) || match.concludedAt) return null
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>Guest scorer</Text>
    <Text style={styles.body}>Let someone at the pitch score this match. They scan your QR code and enter their name, then you approve them.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.dangerText}>{error}</Text> : null}
    {guest?.status === 'offered' && guest.qr ? <><Image accessibilityLabel="Guest scorer QR code" source={{ uri: guest.qr }} style={{ width: 250, height: 250, alignSelf: 'center', backgroundColor: '#ffffff' }} /><Text style={styles.body}>Scan with the phone camera. Single use. Expires in ten minutes.</Text></> : null}
    {guest?.status === 'pending' ? <><Text style={styles.cardTitle}>{guest.name} is asking to score</Text><Text style={styles.body}>Check this is the person beside you. Approval gives access only to this match.</Text><Button disabled={busy || disabled} label={'Approve ' + guest.name} onPress={() => run('approve', guest.id)} styles={styles} /></> : null}
    {guest?.status === 'approved' ? <Text accessibilityLiveRegion="polite" style={styles.cardTitle}>{guest.name} can score this match</Text> : null}
    {['offered', 'pending', 'approved'].includes(guest?.status) ? <Button disabled={busy || disabled} danger label="Remove guest access" onPress={() => run('revoke', guest.id)} styles={styles} /> : <Button disabled={busy || disabled} label="Add guest scorer" onPress={() => run('create')} styles={styles} />}
  </View>
}
