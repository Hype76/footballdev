import { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { supabase } from './supabase'
import { kitImageUrl, kitLabel, readClubKits } from '../../../src/lib/club-kits.js'

export function ClubKitDisplay({ clubId, shirtChoice, textStyle }) {
  const [value, setValue] = useState({ clubId: '', kits: {} })
  const [failedImage, setFailedImage] = useState('')
  useEffect(() => {
    let active = true
    readClubKits(supabase, clubId).then(kits => { if (active) setValue({ clubId, kits }) }).catch(() => {})
    return () => { active = false }
  }, [clubId])
  const kit = value.clubId === clubId ? value.kits[shirtChoice] : null
  const uri = kitImageUrl(supabase, kit), label = kitLabel(shirtChoice)
  return <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
    {['home', 'away'].includes(shirtChoice) ? uri && failedImage !== uri
      ? <Image accessible={false} source={{ uri }} onError={() => setFailedImage(uri)} resizeMode="contain" style={{ width: 56, height: 56 }} />
      : <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons accessible={false} name="tshirt-crew" size={48} color={kit?.colour || '#1d4ed8'} /><MaterialCommunityIcons accessible={false} name="tshirt-crew-outline" size={48} color={StyleSheet.flatten(textStyle)?.color || '#65786c'} style={{ position: 'absolute' }} /></View> : null}
    <Text style={[textStyle, { flexShrink: 1 }]}>{label}</Text>
  </View>
}
