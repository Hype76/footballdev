import { useEffect, useState } from 'react'
import { Image, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { supabase } from './supabase'
import { kitImageUrl, kitLabel } from '../../../src/lib/club-kits.js'
import { loadMobileClubKits, loadMobileTeamKits, peekMobileClubKits, peekMobileTeamKits } from './mobileKitCache'

export function ClubKitDisplay({ clubId, teamId, shirtChoice, textStyle, clubKits, compact = false }) {
  const cacheKey = `${clubId || ''}:${teamId || ''}`
  const [value, setValue] = useState(() => ({ cacheKey, kits: teamId ? peekMobileTeamKits(clubId, teamId) || clubKits || peekMobileClubKits(clubId) || {} : peekMobileClubKits(clubId) || clubKits || {} }))
  const [failedImage, setFailedImage] = useState('')
  const [loadedImage, setLoadedImage] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  useEffect(() => {
    if (!teamId && clubKits !== undefined) return
    let active = true
    const publish = kits => { if (active) setValue({ cacheKey, kits }) }
    const load = teamId ? loadMobileTeamKits(clubId, teamId, publish, clubKits) : loadMobileClubKits(clubId, publish)
    load.then(publish).catch(() => {})
    return () => { active = false }
  }, [cacheKey, clubId, clubKits, teamId])
  const resolvedKits = value.cacheKey === cacheKey ? value.kits : (clubKits || {})
  const kit = !teamId && clubKits !== undefined ? clubKits?.[shirtChoice] : resolvedKits[shirtChoice]
  const size = compact ? 40 : 56
  const uri = kitImageUrl(supabase, kit), label = kitLabel(shirtChoice)
  return <View accessibilityLabel={label} style={{ flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: compact ? 4 : 12, paddingVertical: 6, ...(compact ? { flex: 1, minWidth: 0 } : {}) }}>
    <Pressable accessibilityRole={uri ? 'button' : undefined} accessibilityLabel={uri ? `Enlarge ${label.toLowerCase()} image` : label} disabled={!uri || failedImage === uri} onPress={event => { event.stopPropagation?.(); setPreviewFailed(false); setPreview({ uri, label }) }} style={{ width: Math.max(44, size), height: Math.max(44, size), alignItems: 'center', justifyContent: 'center' }}>
      {!(uri && loadedImage === uri && failedImage !== uri) ? kit?.colour && ['home', 'away'].includes(shirtChoice)
        ? kit.source === 'team'
          ? <Image accessible={false} source={require('../assets/formation-shirt-white.png')} resizeMode="contain" style={{ width: size, height: size, tintColor: kit.colour.toLowerCase() === '#ffffff' ? undefined : kit.colour }} />
          : <><MaterialCommunityIcons accessible={false} name="tshirt-crew" size={size - 8} color={kit.colour} /><MaterialCommunityIcons accessible={false} name="tshirt-crew-outline" size={size - 8} color={StyleSheet.flatten(textStyle)?.color || '#65786c'} style={{ position: 'absolute' }} /></>
        : <Image accessible={false} source={require('../assets/kit-tbc.png')} resizeMode="contain" style={{ width: size, height: size }} /> : null}
      {uri && failedImage !== uri ? <Image key={uri} accessible={false} source={{ uri }} onLoad={() => setLoadedImage(uri)} onError={() => setFailedImage(uri)} resizeMode="contain" style={{ position: 'absolute', width: size, height: size, opacity: loadedImage === uri ? 1 : 0 }} /> : null}
    </Pressable>
    <Text style={[textStyle, { flexShrink: 1 }, compact && { fontSize: 12, textAlign: 'center' }]}>{label}</Text>
    <Modal visible={Boolean(preview)} animationType="fade" onRequestClose={() => setPreview(null)} presentationStyle="fullScreen">
      <SafeAreaView accessibilityViewIsModal onAccessibilityEscape={() => setPreview(null)} style={{ flex: 1, backgroundColor: '#101816' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
          <Text accessibilityRole="header" style={{ color: '#ffffff', fontSize: 20, fontWeight: '700', flexShrink: 1 }}>{preview?.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close kit image" onPress={() => setPreview(null)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons accessible={false} name="close" size={28} color="#ffffff" />
          </Pressable>
        </View>
        {previewFailed ? <Text accessibilityLiveRegion="polite" style={{ color: '#ffffff', padding: 24 }}>The kit image could not be loaded. Close and try again.</Text> : preview ? <Image accessibilityLabel={`${preview.label} enlarged`} source={{ uri: preview.uri }} onError={() => setPreviewFailed(true)} resizeMode="contain" style={{ flex: 1, width: '100%', marginBottom: 24 }} /> : null}
      </SafeAreaView>
    </Modal>
  </View>
}
