import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native'
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
    } catch { setError('Sharing could not be opened. Select and copy your code or link below.') }
    finally { setSharing(false) }
  }
  const text = { color: palette.textPrimary, fontSize: 16, lineHeight: 24 }
  const action = { minHeight: 48, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: 12 }
  return <View style={{ gap: 12, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={[text, { fontSize: 24, fontWeight: '800' }]}>Give a club 50% off</Text>
    <Text style={text}>Share your personal code with a club joining Football Player.</Text>
    {!promotion && !error ? <ActivityIndicator accessibilityLabel="Loading your promotion code" color={palette.textPrimary} /> : null}
    {promotion ? <>
      <Text style={text}>Your promotion code</Text>
      <Text selectable style={[text, { fontSize: 20, fontWeight: '800', paddingVertical: 8 }]}>{promotion.code}</Text>
      <Text selectable style={text}>{promotion.shareUrl}</Text>
      <Text style={text}>{promotion.terms}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: sharing }} disabled={sharing} onPress={() => void share(false)} style={action}><Text style={[text, { fontWeight: '700' }]}>Share code</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: sharing }} disabled={sharing} onPress={() => void share(true)} style={action}><Text style={[text, { fontWeight: '700' }]}>Share link</Text></Pressable>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={text}>{error}</Text> : null}
    {!promotion && error ? <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={action}><Text style={text}>Try again</Text></Pressable> : null}
  </View>
}
