import { Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors } from '../theme'

export function TextField({
  autoCapitalize = 'none',
  keyboardType = 'default',
  label,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  value,
  multiline = false,
}) {
  const isWeb = Platform.OS === 'web'
  const resolvedKeyboardType = isWeb ? 'default' : keyboardType

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        inputMode={!isWeb && keyboardType === 'email-address' ? 'email' : undefined}
        keyboardType={resolvedKeyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6f7d6d"
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        style={[styles.input, multiline ? styles.multiline : null]}
        value={value}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  multiline: {
    minHeight: 104,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  wrap: {
    gap: 0,
  },
})
