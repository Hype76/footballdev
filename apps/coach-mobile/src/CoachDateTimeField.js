import DateTimePicker from '@react-native-community/datetimepicker'
import { useMemo, useState } from 'react'
import { Platform, Pressable, Text, TextInput, View } from 'react-native'

function normalize(value) {
  return String(value ?? '').trim()
}

function parseDateValue(value) {
  const input = normalize(value)
  const uk = input.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const match = uk || iso
  if (!match) return new Date()
  const year = Number(uk ? match[3] : match[1])
  const month = Number(match[2])
  const day = Number(uk ? match[1] : match[3])
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function parseTimeValue(value) {
  const match = normalize(value).match(/^(\d{2}):(\d{2})$/)
  const date = new Date()
  date.setSeconds(0, 0)
  if (!match) return date
  date.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return date
}

function formatDateValue(date, outputFormat) {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return outputFormat === 'iso' ? `${year}-${month}-${day}` : `${day}-${month}-${year}`
}

function formatTimeValue(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function CoachDateTimeField({
  label,
  minimumDate,
  mode = 'date',
  onChange,
  outputFormat = 'uk',
  styles,
  value,
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [draft, setDraft] = useState(() => mode === 'time' ? parseTimeValue(value) : parseDateValue(value))
  const pickerValue = useMemo(
    () => mode === 'time' ? parseTimeValue(value) : parseDateValue(value),
    [mode, value],
  )
  const apply = (date) => onChange(mode === 'time' ? formatTimeValue(date) : formatDateValue(date, outputFormat))

  if (Platform.OS === 'web') {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          onChangeText={onChange}
          style={styles.input}
          value={normalize(value)}
        />
      </View>
    )
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityHint={`Opens the native ${mode} picker`}
        accessibilityLabel={`${label}, ${normalize(value) || 'not selected'}`}
        accessibilityRole="button"
        onPress={() => {
          setDraft(pickerValue)
          setShowPicker(true)
        }}
        style={({ pressed }) => [styles.input, { justifyContent: 'center' }, pressed && { opacity: 0.75 }]}
      >
        <Text style={styles.inputText}>{normalize(value) || `Choose ${mode}`}</Text>
      </Pressable>
      {showPicker ? (
        <View style={styles.pickerPanel}>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={minimumDate}
            minuteInterval={5}
            mode={mode}
            onChange={(event, nextDate) => {
              if (event.type === 'dismissed') {
                setShowPicker(false)
                return
              }
              if (!nextDate) return
              setDraft(nextDate)
              if (Platform.OS !== 'ios') {
                apply(nextDate)
                setShowPicker(false)
              }
            }}
            value={draft}
          />
          {Platform.OS === 'ios' ? (
            <View style={styles.pickerActions}>
              <Pressable accessibilityRole="button" onPress={() => setShowPicker(false)} style={styles.pickerButton}>
                <Text style={styles.pickerButtonText}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { apply(draft); setShowPicker(false) }} style={styles.pickerButton}>
                <Text style={styles.pickerButtonText}>Done</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
