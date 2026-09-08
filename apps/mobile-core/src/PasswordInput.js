import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

export function PasswordInput({ accessibilityLabel = 'Password', style, ...props }) {
  const [visible, setVisible] = useState(false)
  const colour = StyleSheet.flatten(style)?.color || '#ffffff'
  return <View style={styles.row}>
    <TextInput {...props} accessibilityLabel={accessibilityLabel} autoCapitalize="none" autoCorrect={false}
      secureTextEntry={!visible} style={[style, styles.input]} />
    <Pressable accessibilityRole="button" accessibilityLabel={`${visible ? 'Hide' : 'Show'} ${accessibilityLabel.toLowerCase()}`}
      onPress={() => setVisible((value) => !value)} style={styles.toggle}>
      <Text style={[styles.text, { color: colour }]}>{visible ? 'Hide' : 'Show'}</Text>
    </Pressable>
  </View>
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  input: { flex: 1, minWidth: 0 },
  toggle: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  text: { fontSize: 14, fontWeight: '800' },
})
