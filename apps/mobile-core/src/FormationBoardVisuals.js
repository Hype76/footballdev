import { Image, Text, View } from 'react-native'

const WHITE_SHIRT = require('../assets/formation-shirt-white.png')
const GOLD_SHIRT = require('../assets/formation-shirt-gold.png')

export const formationVisualStyles = {
  benchPlayer: { alignItems: 'center', minWidth: 74 },
  shirtSmall: { height: 54, resizeMode: 'contain', width: 60 },
  shirtSmallName: { backgroundColor: 'rgb(3,35,20)', borderRadius: 6, color: 'white', fontSize: 12, fontWeight: '700', lineHeight: 15, marginTop: -8, maxWidth: 78, paddingHorizontal: 6, paddingVertical: 2, textAlign: 'center' },
  shirtSmallNumber: { color: 'rgb(5,62,34)', fontSize: 15, fontWeight: '900', left: 0, position: 'absolute', right: 0, textAlign: 'center', top: 18 },
  shirtWrap: { alignItems: 'center', height: 54, width: 60 },
  marker: { alignItems: 'center', height: 70, justifyContent: 'flex-start', position: 'absolute', transform: [{ translateX: -32 }, { translateY: -25 }], width: 64, zIndex: 10 },
  markerImage: { height: 46, resizeMode: 'contain', width: 52 },
  markerName: { backgroundColor: 'rgba(3,35,20,0.94)', borderRadius: 6, color: 'rgb(255,255,255)', fontSize: 12, fontWeight: '700', lineHeight: 15, marginTop: -6, maxWidth: 64, paddingHorizontal: 3, paddingVertical: 2, textAlign: 'center' },
  markerNumber: { color: 'rgb(5,62,34)', fontSize: 16, fontWeight: '900', left: 0, position: 'absolute', right: 0, textAlign: 'center', top: 15 },
  markerNumberGoalkeeper: { color: 'rgb(34,24,4)' },
  pitch: { aspectRatio: 0.69, backgroundColor: 'rgb(10,108,47)', borderColor: 'rgb(255,255,255)', borderRadius: 18, borderWidth: 3, overflow: 'hidden', position: 'relative', width: '100%' },
  pitchArc: { borderColor: 'rgba(255,255,255,0.9)', borderRadius: 35, borderWidth: 2, height: 70, position: 'absolute', width: 70 },
  pitchArcBottom: { bottom: -35 },
  pitchArcTop: { top: -35 },
  pitchArcWindow: { height: 35, left: '50%', overflow: 'hidden', position: 'absolute', transform: [{ translateX: -35 }], width: 70 },
  pitchArcWindowBottom: { bottom: '14%' },
  pitchArcWindowTop: { top: '14%' },
  pitchBoxBottom: { borderBottomWidth: 0, bottom: 0 },
  pitchBoxLarge: { borderColor: 'rgba(255,255,255,0.82)', borderWidth: 2, height: '14%', left: '24%', position: 'absolute', width: '52%' },
  pitchBoxSmall: { borderColor: 'rgba(255,255,255,0.82)', borderWidth: 2, height: '6%', left: '38%', position: 'absolute', width: '24%' },
  pitchBoxTop: { borderTopWidth: 0, top: 0 },
  pitchCentreCircle: { borderColor: 'rgba(255,255,255,0.82)', borderRadius: 43, borderWidth: 2, height: 86, left: '50%', position: 'absolute', top: '50%', transform: [{ translateX: -43 }, { translateY: -43 }], width: 86 },
  pitchCentreSpot: { backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: 5, height: 10, left: '50%', position: 'absolute', top: '50%', transform: [{ translateX: -5 }, { translateY: -5 }], width: 10 },
  pitchCorner: { borderColor: 'rgba(255,255,255,0.9)', borderRadius: 14, borderWidth: 2, height: 28, position: 'absolute', width: 28 },
  pitchCornerBottom: { bottom: -14 },
  pitchCornerLeft: { left: -14 },
  pitchCornerRight: { right: -14 },
  pitchCornerTop: { top: -14 },
  pitchHalfway: { backgroundColor: 'rgba(255,255,255,0.82)', height: 2, left: 0, position: 'absolute', right: 0, top: '50%' },
  pitchPenaltySpot: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 4, height: 8, left: '50%', position: 'absolute', transform: [{ translateX: -4 }], width: 8 },
  pitchPenaltySpotBottom: { bottom: '9%' },
  pitchPenaltySpotTop: { top: '9%' },
  pitchStripe: { height: '12.5%', left: 0, position: 'absolute', right: 0 },
}

export function FormationPitchLines({ styles }) {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => <View key={index} style={[styles.pitchStripe, { backgroundColor: index % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.075)', top: `${index * 12.5}%` }]} />)}
      <View style={styles.pitchHalfway} />
      <View style={styles.pitchCentreCircle} />
      <View style={styles.pitchCentreSpot} />
      <View style={[styles.pitchBoxLarge, styles.pitchBoxTop]} />
      <View style={[styles.pitchBoxLarge, styles.pitchBoxBottom]} />
      <View style={[styles.pitchBoxSmall, styles.pitchBoxTop]} />
      <View style={[styles.pitchBoxSmall, styles.pitchBoxBottom]} />
      <View style={[styles.pitchArcWindow, styles.pitchArcWindowTop]}><View style={[styles.pitchArc, styles.pitchArcTop]} /></View>
      <View style={[styles.pitchArcWindow, styles.pitchArcWindowBottom]}><View style={[styles.pitchArc, styles.pitchArcBottom]} /></View>
      <View style={[styles.pitchPenaltySpot, styles.pitchPenaltySpotTop]} />
      <View style={[styles.pitchPenaltySpot, styles.pitchPenaltySpotBottom]} />
      <View style={[styles.pitchCorner, styles.pitchCornerLeft, styles.pitchCornerTop]} />
      <View style={[styles.pitchCorner, styles.pitchCornerRight, styles.pitchCornerTop]} />
      <View style={[styles.pitchCorner, styles.pitchCornerLeft, styles.pitchCornerBottom]} />
      <View style={[styles.pitchCorner, styles.pitchCornerRight, styles.pitchCornerBottom]} />
    </>
  )
}

export function FormationPlayerArtwork({ name, number, goalkeeper = false, children, styles = formationVisualStyles }) {
  return <>
    <Image accessibilityIgnoresInvertColors source={goalkeeper ? GOLD_SHIRT : WHITE_SHIRT} style={styles.markerImage} />
    {number ? <Text style={[styles.markerNumber, goalkeeper && styles.markerNumberGoalkeeper]}>{number}</Text> : null}
    {children}
    <Text numberOfLines={1} style={styles.markerName}>{name}</Text>
  </>
}

export function FormationSubArtwork({ goalkeeper = false, name, number, styles = formationVisualStyles }) {
  return <View style={styles.benchPlayer}>
    <View style={styles.shirtWrap}>
      <Image accessibilityIgnoresInvertColors source={goalkeeper ? GOLD_SHIRT : WHITE_SHIRT} style={styles.shirtSmall} />
      {number ? <Text style={styles.shirtSmallNumber}>{number}</Text> : null}
    </View>
    <Text numberOfLines={1} style={styles.shirtSmallName}>{name}</Text>
  </View>
}
