import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'
import { createMobileEvaluation, getMobileAssessmentFields, getMobilePreviousEvaluations } from '../lib/data'
import { colors, spacing } from '../theme'

const decisionOptions = [
  { label: 'No Decision', value: '' },
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
]

function isScoreField(fieldType) {
  return fieldType === 'score_1_5' || fieldType === 'score_1_10' || fieldType === 'number'
}

function getScoreOptions(fieldType) {
  const maxValue = fieldType === 'score_1_10' ? 10 : 5
  return Array.from({ length: maxValue }, (_, index) => String(index + 1))
}

function getInitialValues(fields) {
  return Object.fromEntries(fields.map((field) => [field.id, isScoreField(field.type) ? '' : '']))
}

function normalizeFieldValue(field, value) {
  if (isScoreField(field.type)) {
    const numericValue = Number(value)
    return Number.isNaN(numericValue) ? '' : numericValue
  }

  return String(value || '').trim()
}

function buildFormResponses(fields, values) {
  return Object.fromEntries(
    fields
      .map((field) => [field.label, normalizeFieldValue(field, values[field.id])])
      .filter(([, value]) => value !== ''),
  )
}

function FieldOptions({ field, value, onChange }) {
  const options = field.type === 'select' ? field.options : getScoreOptions(field.type)

  return (
    <View style={styles.optionGrid}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(field.id, String(option))}
          style={[styles.optionButton, String(value) === String(option) ? styles.optionButtonActive : null]}
        >
          <Text style={[styles.optionText, String(value) === String(option) ? styles.optionTextActive : null]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function AssessmentField({ field, value, onChange }) {
  const helper = isScoreField(field.type)
    ? field.type === 'score_1_10'
      ? 'Score 1 to 10.'
      : 'Score 1 to 5.'
    : field.required
      ? 'Required.'
      : ''

  return (
    <View style={styles.fieldBlock}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{field.label}</Text>
        {field.required ? <Text style={styles.required}>Required</Text> : null}
      </View>
      {helper ? <Text style={styles.fieldHelp}>{helper}</Text> : null}

      {field.type === 'select' || isScoreField(field.type) ? (
        <FieldOptions field={field} onChange={onChange} value={value} />
      ) : (
        <TextField
          autoCapitalize="sentences"
          multiline={field.type === 'textarea'}
          onChangeText={(nextValue) => onChange(field.id, nextValue)}
          placeholder={field.label}
          value={String(value || '')}
        />
      )}
    </View>
  )
}

function DecisionOption({ active, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active ? styles.segmentActive : null]}>
      <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{label}</Text>
    </Pressable>
  )
}

function getPreviousItems(evaluation) {
  const responses = evaluation.formResponses && Object.keys(evaluation.formResponses).length > 0
    ? evaluation.formResponses
    : {
        ...evaluation.scores,
        Strengths: evaluation.comments?.strengths,
        Improvements: evaluation.comments?.improvements,
        'Overall Comments': evaluation.comments?.overall,
      }

  return Object.entries(responses)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .slice(0, 6)
}

function PreviousEvaluationCard({ evaluation }) {
  const items = getPreviousItems(evaluation)

  return (
    <View style={styles.previousCard}>
      <View style={styles.previousHeader}>
        <Text style={styles.previousTitle}>{evaluation.date || 'No date'}</Text>
        <Text style={styles.previousScore}>Score {evaluation.averageScore !== null ? Number(evaluation.averageScore).toFixed(1) : '-'}</Text>
      </View>
      <Text style={styles.previousMeta}>{[evaluation.session, evaluation.coach, evaluation.status].filter(Boolean).join(' | ')}</Text>
      <View style={styles.previousItems}>
        {items.map(([label, value]) => (
          <View key={label} style={styles.previousItem}>
            <Text style={styles.previousItemLabel}>{label}</Text>
            <Text style={styles.previousItemValue}>{String(value)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export function AssessPlayerScreen({ onBack, onSaved, player, session = null, user }) {
  const [fields, setFields] = useState([])
  const [values, setValues] = useState({})
  const [decision, setDecision] = useState('')
  const [previousEvaluations, setPreviousEvaluations] = useState([])
  const [showPrevious, setShowPrevious] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setIsLoading(true)
      setError('')

      try {
        const [nextFields, nextPreviousEvaluations] = await Promise.all([
          getMobileAssessmentFields(user),
          getMobilePreviousEvaluations(user, player),
        ])

        if (isMounted) {
          setFields(nextFields)
          setValues(getInitialValues(nextFields))
          setPreviousEvaluations(nextPreviousEvaluations)
        }
      } catch (loadError) {
        console.error(loadError)
        if (isMounted) {
          setError(loadError.message || 'Assessment setup could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      isMounted = false
    }
  }, [player, user])

  const averageScore = useMemo(() => {
    const scores = fields
      .map((field) => (isScoreField(field.type) ? Number(values[field.id]) : Number.NaN))
      .filter((value) => !Number.isNaN(value) && value > 0)

    if (scores.length === 0) {
      return null
    }

    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }, [fields, values])

  const updateField = (fieldId, value) => {
    setMessage('')
    setError('')
    setValues((current) => ({ ...current, [fieldId]: value }))
  }

  const missingRequiredField = fields.find((field) => field.required && String(values[field.id] || '').trim() === '')

  const handleSave = async () => {
    if (missingRequiredField) {
      setError(`${missingRequiredField.label} is required.`)
      return
    }

    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      const saved = await createMobileEvaluation(
        user,
        player,
        {
          decision,
          formResponses: buildFormResponses(fields, values),
        },
        session,
      )
      setMessage(`Assessment saved. Average score ${Number(saved.average_score || 0).toFixed(1)}.`)
      setValues(getInitialValues(fields))
      setDecision('')
      const nextPreviousEvaluations = await getMobilePreviousEvaluations(user, player)
      setPreviousEvaluations(nextPreviousEvaluations)
      onSaved?.(saved, nextPreviousEvaluations)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Could not save assessment.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.webWrap}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topbar}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={styles.topbarTitle}>Assess Player</Text>
          </View>

          <View style={styles.shell}>
            <View style={styles.pageHeader}>
              <Text style={styles.kicker}>{session?.title || player.team || 'Assessment'}</Text>
              <Text style={styles.title}>{player.playerName}</Text>
              <Text style={styles.description}>Complete the club assessment form from mobile.</Text>
              <Text style={styles.scoreSummary}>Current average: {averageScore !== null ? averageScore.toFixed(1) : '-'}</Text>
            </View>

            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Loading assessment form...</Text>
              </View>
            ) : (
              <>
                {previousEvaluations.length > 0 ? (
                  <View style={styles.card}>
                    <View style={styles.previousSummary}>
                      <View style={styles.previousText}>
                        <Text style={styles.cardTitle}>Previous assessments</Text>
                        <Text style={styles.cardCopy}>{previousEvaluations.length} previous assessment{previousEvaluations.length === 1 ? '' : 's'} found.</Text>
                      </View>
                      <Button onPress={() => setShowPrevious((current) => !current)} variant="secondary">
                        {showPrevious ? 'Hide' : 'View'}
                      </Button>
                    </View>
                    {showPrevious ? (
                      <View style={styles.previousList}>
                        {previousEvaluations.map((evaluation) => (
                          <PreviousEvaluationCard evaluation={evaluation} key={evaluation.id} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.card}>
                  {fields.map((field) => (
                    <AssessmentField field={field} key={field.id} onChange={updateField} value={values[field.id]} />
                  ))}

                  <View>
                    <Text style={styles.fieldLabel}>Decision</Text>
                    <View style={styles.segmentWrap}>
                      {decisionOptions.map((option) => (
                        <DecisionOption
                          active={decision === option.value}
                          key={option.label}
                          label={option.label}
                          onPress={() => setDecision(option.value)}
                        />
                      ))}
                    </View>
                  </View>

                  {message ? <Text style={styles.message}>{message}</Text> : null}
                  {error ? <Text style={styles.error}>{error}</Text> : null}

                  <Button disabled={isSaving || Boolean(missingRequiredField)} onPress={handleSave}>
                    {isSaving ? 'Saving...' : 'Save Assessment'}
                  </Button>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  backText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    marginTop: 12,
    padding: spacing.card,
  },
  cardCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 20,
  },
  fieldBlock: {
    gap: 8,
  },
  fieldHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  fieldHelp: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  loading: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    marginTop: 12,
    padding: spacing.card,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  message: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 20,
  },
  optionButton: {
    alignItems: 'center',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '18%',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: 8,
  },
  optionButtonActive: {
    backgroundColor: colors.sidebarActive,
    borderColor: colors.accent,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '900',
  },
  optionTextActive: {
    color: colors.text,
  },
  pageHeader: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  previousCard: {
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  previousHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  previousItem: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  previousItemLabel: {
    color: colors.secondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  previousItemValue: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  previousItems: {
    gap: 8,
    marginTop: 10,
  },
  previousList: {
    gap: 10,
  },
  previousMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  previousScore: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  previousSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  previousText: {
    flex: 1,
  },
  previousTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  required: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scoreSummary: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 12,
  },
  scroll: {
    padding: Platform.OS === 'web' ? 10 : 0,
    paddingBottom: 36,
  },
  segment: {
    alignItems: 'center',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentActive: {
    backgroundColor: colors.sidebarActive,
    borderColor: colors.accent,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  segmentTextActive: {
    color: colors.text,
  },
  segmentWrap: {
    flexDirection: 'row',
    gap: 8,
  },
  shell: {
    backgroundColor: colors.shell,
    borderColor: colors.border,
    borderRadius: Platform.OS === 'web' ? 8 : 0,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    padding: 12,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 31,
    marginTop: 9,
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  topbarTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  webWrap: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: Platform.OS === 'web' ? 460 : undefined,
    width: '100%',
  },
})
