import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, Share, Text, View } from 'react-native'
import { mobileAccountRequest } from '../../mobile-core/src/mobileSignup'

export function CoachClubPromotionScreen({ user, palette }) {
  const [promotion, setPromotion] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [sharing, setSharing] = useState(false)
  useEffect(() => {
    let active = true
    setPromotion(null); setError('')
    mobileAccountRequest('coach', 'coach-club-promotion', {}, user.id)
      .then(value => { if (active) setPromotion(value) })
      .catch(failure => { if (active) setError(failure.message || 'Your code could not be loaded. Please try again.') })
    return () => { active = false }
  }, [user.id, retry])
  const share = async link => {
    if (!promotion || sharing) return
    setSharing(true); setError('')
    try {
      await Share.share({ message: link
        ? `Get 50% off your first 3 monthly Club payments with my Football Player code ${promotion.code}. ${promotion.shareUrl}\n\n${promotion.terms}`
        : `Football Player Coach promotion code: ${promotion.code}\n\n${promotion.terms}` })
    } catch { setError('Sharing could not be opened. Please try again, or select and copy your code.') }
    finally { setSharing(false) }
  }
  const text = { color: palette.textPrimary, fontSize: 16, lineHeight: 24 }
  const action = { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, flex: 1, opacity: sharing ? 0.5 : 1 }
  const secondary = { ...text, color: palette.textSecondary, fontSize: 14, lineHeight: 21 }
  return <View style={{ gap: 16, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={[text, { fontSize: 24, fontWeight: '800' }]}>Give a club 50% off</Text>
    <Text style={text}>Help a new club get started. Share your code or let them scan your QR code.</Text>
    {!promotion && !error ? <ActivityIndicator accessibilityLabel="Loading your promotion code" color={palette.textPrimary} /> : null}
    {promotion ? <>
      <View style={{ gap: 4 }}>
        <Text style={secondary}>Your promotion code</Text>
        <Text selectable style={[text, { fontSize: 20, fontWeight: '800', letterSpacing: 0.5 }]}>{promotion.code}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: sharing }} disabled={sharing} onPress={() => void share(true)} style={[action, { backgroundColor: palette.accent }]}><Text style={[text, { color: palette.accentForeground, fontWeight: '700' }]}>Share link</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: sharing }} disabled={sharing} onPress={() => void share(false)} style={[action, { borderWidth: 1, borderColor: palette.border }]}><Text style={[text, { fontWeight: '700' }]}>Share code</Text></Pressable>
      </View>
      {promotion.qr ? <View style={{ gap: 12, alignItems: 'center', paddingTop: 20, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Text accessibilityRole="header" style={[text, { fontWeight: '700' }]}>Scan to join</Text>
        <Image accessibilityLabel="Scan to join Football Player with your coach promotion code" source={{ uri: promotion.qr }} resizeMode="contain" style={{ width: 248, height: 248, maxWidth: '100%', backgroundColor: '#ffffff' }} />
        <Text style={[secondary, { textAlign: 'center' }]}>Open the camera on another phone. Your code is added automatically.</Text>
      </View> : null}
      <Text style={[secondary, { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 16 }]}>{promotion.terms}</Text>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={text}>{error}</Text> : null}
    {!promotion && error ? <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={action}><Text style={text}>Try again</Text></Pressable> : null}
  </View>
}
