import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { getParentProgressionPlot } from '../../mobile-core/src/parentDevelopmentProgression.js'

export function ParentDevelopmentProgressionChart({ colors, progression, styles }) {
  const [width, setWidth] = useState(280)
  const [selected, setSelected] = useState(null)
  const points = progression?.points || []
  if (points.length < 2) return null
  const plot = getParentProgressionPlot(points, width)
  const active = points[selected] || points.at(-1)
  return <View style={{ borderBottomColor: colors.border, borderBottomWidth: 1, gap: 8, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={styles.cardTitle}>Progression chart</Text>
    <Text style={styles.meta}>{progression.source === 'shared_history' ? 'Shared assessments for this form, oldest to newest, out of 10.' : 'Scores are charted oldest to newest out of 10.'}</Text>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <ScrollView accessibilityLabel="Progression chart. Swipe horizontally for more assessments." horizontal alwaysBounceHorizontal={false} showsHorizontalScrollIndicator style={{ height: 206 }}>
        <View style={{ height: 206, width: plot.width }}>
          {[0, 5, 10].map(value => <View key={value} accessible={false} style={{ left: 0, position: 'absolute', right: 0, top: plot.top + plot.height * (1 - value / 10) }}><Text style={[styles.meta, { position: 'absolute', top: -8, width: 24 }]}>{value}</Text><View style={{ backgroundColor: colors.border, height: 1, marginLeft: 24 }} /></View>)}
          {plot.segments.map((segment, index) => <View key={index} accessible={false} testID="parent-progression-line" style={{ backgroundColor: colors.accentText, height: 2, left: segment.left, position: 'absolute', top: segment.top, transform: [{ rotate: segment.rotation }], width: segment.width }} />)}
          {plot.positions.map((point, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${point.label}: ${point.value} out of 10`} accessibilityState={{ selected: selected === index }} onPress={() => setSelected(index)} style={{ alignItems: 'center', height: 44, justifyContent: 'center', left: point.x - 22, position: 'absolute', top: point.y - 22, width: 44 }}><View style={{ backgroundColor: colors.accentText, borderRadius: 4, height: 8, width: 8 }} /><Text accessible={false} style={[styles.meta, { color: colors.accentText, position: 'absolute', top: -2 }]}>{point.value}</Text></Pressable>)}
          {[plot.positions[0], plot.positions.at(-1)].map((point, index) => <Text key={index} accessible={false} style={[styles.meta, { left: point.x - (index ? 98 : 10), position: 'absolute', textAlign: index ? 'right' : 'left', top: 183, width: 108 }]}>{point.label}</Text>)}
        </View>
      </ScrollView>
    </View>
    <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.body, { minHeight: 22 }]}>{active.label}: {active.value} / 10</Text>
  </View>
}
