import { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { supabase } from './supabase'
import { kitImageUrl, kitLabel } from '../../../src/lib/club-kits.js'
import { loadMobileClubKits, peekMobileClubKits } from './mobileKitCache'

export function ClubKitDisplay({ clubId, shirtChoice, textStyle, clubKits, compact = false }) {
  const [value, setValue] = useState(() => ({ clubId, kits: peekMobileClubKits(clubId) || {} }))
  const [failedImage, setFailedImage] = useState('')
  useEffect(() => {
    if (clubKits !== undefined) return
    let active = true
    const publish = kits => { if (active) setValue({ clubId, kits }) }
    loadMobileClubKits(clubId, publish).then(publish).catch(() => {})
    return () => { active = false }
  }, [clubId, clubKits])
  const kit = clubKits !== undefined ? clubKits?.[shirtChoice] : value.clubId === clubId ? value.kits[shirtChoice] : null
  const size = compact ? 40 : 56
  const uri = kitImageUrl(supabase, kit), label = kitLabel(shirtChoice)
  return <View accessible accessibilityLabel={label} style={{ flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: compact ? 4 : 12, paddingVertical: 6, ...(compact ? { flex: 1, minWidth: 0 } : {}) }}>
    {['home', 'away'].includes(shirtChoice) ? uri && failedImage !== uri
      ? <Image accessible={false} source={{ uri }} onError={() => setFailedImage(uri)} resizeMode="contain" style={{ width: size, height: size }} />
      : <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons accessible={false} name="tshirt-crew" size={size - 8} color={kit?.colour || '#1d4ed8'} /><MaterialCommunityIcons accessible={false} name="tshirt-crew-outline" size={size - 8} color={StyleSheet.flatten(textStyle)?.color || '#65786c'} style={{ position: 'absolute' }} /></View> : null}
    <Text style={[textStyle, { flexShrink: 1 }, compact && { fontSize: 12, textAlign: 'center' }]}>{label}</Text>
  </View>
}
