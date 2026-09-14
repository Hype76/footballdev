import { Image, Pressable, Text, View } from 'react-native'

export function PartnersBanner({ onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Partners and Special Offers" accessibilityHint="Opens partners and offers" onPress={onPress} style={({ pressed }) => ({ minHeight: 156, borderRadius: 16, overflow: 'hidden', justifyContent: 'center', backgroundColor: '#071d33', opacity: pressed ? 0.85 : 1 })}>
    <Image accessible={false} source={require('../assets/partners-banner.png')} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} />
    <View style={{ width: '65%', padding: 20, gap: 10 }}>
      <Text style={{ color: '#ffffff', fontSize: 23, lineHeight: 28, fontWeight: '800' }}>Partners &amp;{ '\n' }Special Offers</Text>
      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Explore what’s on offer →</Text>
    </View>
  </Pressable>
}

export function PartnersScreen({ textStyle, headingStyle }) {
  return <View style={{ gap: 16, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={headingStyle}>Partners &amp; Special Offers</Text>
    <Text style={textStyle}>Our partners and their offers will appear here. Check back soon.</Text>
  </View>
}
