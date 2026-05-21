import { useState } from 'react'
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StatusBar as NativeStatusBar, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors, screen } from './theme'

export function PrimaryButton({ children, disabled = false, loading = false, onPress, variant = 'primary' }) {
  const isSecondary = variant === 'secondary'

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isSecondary ? styles.secondaryButton : styles.primaryButton,
        pressed && !disabled ? styles.pressed : null,
        (disabled || loading) ? styles.disabled : null,
      ]}
    >
      {loading ? <ActivityIndicator color={isSecondary ? colors.text : '#000000'} /> : (
        <Text style={[styles.buttonText, isSecondary ? styles.secondaryButtonText : null]}>{children}</Text>
      )}
    </Pressable>
  )
}

export function MobileScreen({ children, refreshControl }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={refreshControl}>
        <View style={styles.shell}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  )
}

export function ScreenHeader({ copy, kicker, logoSource, title }) {
  return (
    <>
      <Image source={logoSource} style={styles.logo} resizeMode="contain" />
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.pageTitle}>{title}</Text>
      {copy ? <Text style={styles.pageCopy}>{copy}</Text> : null}
    </>
  )
}

export function LoadingRow({ message }) {
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.simpleBody}>{message}</Text>
    </View>
  )
}

export function EmptyState({ message }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.simpleBody}>{message}</Text>
    </View>
  )
}

export function ChoiceGroup({ options, onChange, selectedValue, title }) {
  return (
    <View style={styles.choiceGroupCard}>
      {title ? <Text style={styles.choiceGroupTitle}>{title}</Text> : null}
      <View style={styles.choiceGroup}>
        {options.map((option) => {
          const isActive = option.value === selectedValue

          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.choiceButton, isActive ? styles.choiceButtonActive : null]}
            >
              <Text style={[styles.choiceLabel, isActive ? styles.choiceLabelActive : null]}>{option.label}</Text>
              {option.meta ? (
                <Text style={[styles.choiceMeta, isActive ? styles.choiceMetaActive : null]}>{option.meta}</Text>
              ) : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export function SegmentedControl({ options, onChange, selectedValue }) {
  return (
    <View style={styles.segmentedControl}>
      {options.map((option) => {
        const isActive = option.value === selectedValue

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segmentButton, isActive ? styles.segmentButtonActive : null]}
          >
            <Text style={[styles.segmentText, isActive ? styles.segmentTextActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function LoadingScreen({ message }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.simpleBody}>{message}</Text>
      </View>
    </SafeAreaView>
  )
}

export function AccessScreen({ message, onSignOut, title }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <Text style={styles.screenTitle}>{title}</Text>
        <Text style={styles.screenCopy}>{message}</Text>
        <PrimaryButton onPress={onSignOut} variant="secondary">Sign out</PrimaryButton>
      </View>
    </SafeAreaView>
  )
}

export function LockedScreen({ errorMessage, logoSource, onUnlock }) {
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [message, setMessage] = useState(errorMessage || '')

  async function handleUnlock() {
    setIsUnlocking(true)
    setMessage('')

    try {
      await onUnlock()
    } catch (error) {
      console.error(error)
      setMessage(error.message || 'Unlock failed.')
    } finally {
      setIsUnlocking(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <Image source={logoSource} style={styles.logo} resizeMode="contain" />
        <Text style={styles.screenTitle}>Unlock app.</Text>
        <Text style={styles.screenCopy}>Use your device security to continue.</Text>
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <PrimaryButton loading={isUnlocking} onPress={handleUnlock}>Unlock</PrimaryButton>
      </View>
    </SafeAreaView>
  )
}

export function MobileLoginScreen({
  authError,
  copy,
  emailPlaceholder,
  kicker,
  logoSource,
  meta,
  signIn,
  title,
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const canSubmit = Boolean(email.trim() && password)

  async function handleLogin() {
    if (!canSubmit || isSubmitting) {
      return
    }

    setIsSubmitting(true)

    try {
      await signIn(email.trim(), password)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <NativeStatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.loginScroll}>
        <View style={styles.loginShell}>
          <Image source={logoSource} style={styles.logo} resizeMode="contain" />
          <Text style={styles.kicker}>{kicker}</Text>
          <Text style={styles.screenTitle}>{title}</Text>
          <Text style={styles.screenCopy}>{copy}</Text>

          <View style={styles.simpleCard}>
            <TextField
              autoComplete="email"
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              placeholder={emailPlaceholder}
              returnKeyType="next"
              textContentType="username"
              value={email}
            />
            <TextField
              autoComplete="current-password"
              label="Password"
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
              placeholder="Password"
              returnKeyType="done"
              secureTextEntry
              textContentType="password"
              value={password}
            />
            {authError ? <Text style={styles.error}>{authError}</Text> : null}
            <PrimaryButton disabled={!canSubmit} loading={isSubmitting} onPress={handleLogin}>Log in</PrimaryButton>
          </View>

          <Text style={styles.meta}>{meta}</Text>
          <LegalFooter />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export function TextField({
  autoComplete,
  autoCapitalize = 'none',
  blurOnSubmit,
  keyboardType = 'default',
  label,
  multiline = false,
  onChangeText,
  onSubmitEditing,
  placeholder,
  returnKeyType,
  secureTextEntry = false,
  textContentType,
  value,
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        blurOnSubmit={blurOnSubmit}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline ? styles.multilineInput : null]}
        textContentType={textContentType}
        value={value}
      />
    </View>
  )
}

export function ScoreStepper({ label, max = 5, onChange, value }) {
  const numericValue = Number(value || 0)

  return (
    <View style={styles.stepper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => onChange(Math.max(numericValue - 1, 0))}
          style={styles.stepperButton}
        >
          <Text style={styles.stepperButtonText}>-</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{numericValue}</Text>
        <Pressable
          onPress={() => onChange(Math.min(numericValue + 1, max))}
          style={styles.stepperButton}
        >
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function StatCard({ label, value }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

export function OverviewPanel({ isOpen, onToggle, stats, summary }) {
  return (
    <View style={styles.overviewPanel}>
      <Pressable onPress={onToggle} style={styles.overviewButton}>
        <View>
          <Text style={styles.overviewLabel}>Overview</Text>
          <Text style={styles.overviewSummary}>{summary}</Text>
        </View>
        <Text style={styles.overviewAction}>{isOpen ? 'Hide' : 'Show'}</Text>
      </Pressable>
      {isOpen ? (
        <View style={styles.statGrid}>
          {stats.map((stat) => <StatCard key={stat.label} label={stat.label} value={stat.value} />)}
        </View>
      ) : null}
    </View>
  )
}

function getEventTitle(event) {
  if (event.eventType === 'goal') {
    return event.teamSide === 'opponent' ? 'Goal against' : 'Goal'
  }

  if (event.eventType === 'score_correction') {
    return 'Score corrected'
  }

  if (event.eventType === 'status_change') {
    return 'Status update'
  }

  return 'Update'
}

function getEventMeta(event) {
  const parts = []

  if (event.minute !== null && event.minute !== undefined) {
    parts.push(`${event.minute}'`)
  }

  if (event.scorerName) {
    parts.push(event.scorerShirtNumber ? `${event.scorerName} (${event.scorerShirtNumber})` : event.scorerName)
  }

  if (event.assistName) {
    parts.push(event.assistShirtNumber ? `Assist ${event.assistName} (${event.assistShirtNumber})` : `Assist ${event.assistName}`)
  }

  if (parts.length === 0 && event.eventType === 'score_correction') {
    parts.push('Latest score has been updated')
  }

  return parts.join(' | ')
}

export function MatchCard({ isBusy = false, match, onVolunteerScorer }) {
  const isLive = ['live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(match.status)
  const statusLabel = String(match.status || 'scheduled').replace(/_/g, ' ')
  const latestCorrection = match.events?.find((event) => event.eventType === 'score_correction')

  return (
    <View style={styles.matchCard}>
      <View style={styles.matchHeader}>
        <Text style={[styles.statusPill, isLive ? styles.livePill : null]}>{statusLabel}</Text>
        <Text style={styles.matchDate}>{[match.matchDate, match.kickoffTime].filter(Boolean).join(' at ') || 'Date not set'}</Text>
      </View>
      <Text style={styles.matchTitle}>{match.teamName || 'Our team'} v {match.opponent || 'Opponent'}</Text>
      <Text style={styles.scoreText}>{match.homeScore} - {match.awayScore}</Text>
      {latestCorrection ? (
        <View style={styles.correctionNotice}>
          <Text style={styles.correctionNoticeText}>Score corrected to {latestCorrection.homeScore} - {latestCorrection.awayScore}</Text>
        </View>
      ) : null}
      {match.venueName ? <Text style={styles.matchMeta}>{match.venueName}</Text> : null}
      {onVolunteerScorer && !match.isScorer ? (
        <PrimaryButton
          disabled={isBusy || match.hasInterest}
          onPress={() => onVolunteerScorer(match)}
          variant={match.hasInterest ? 'secondary' : 'primary'}
        >
          {match.hasInterest ? 'Interest Sent' : 'Volunteer As Scorer'}
        </PrimaryButton>
      ) : null}
      {match.events?.length ? (
        <View style={styles.eventList}>
          <Text style={styles.eventListTitle}>Recent updates</Text>
          {match.events.slice(0, 5).map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <View style={styles.matchHeader}>
                <Text style={[styles.eventTitle, event.eventType === 'score_correction' ? styles.correctionText : null]}>
                  {getEventTitle(event)}
                </Text>
                <Text style={styles.eventScore}>{event.homeScore} - {event.awayScore}</Text>
              </View>
              {getEventMeta(event) ? <Text style={styles.eventText}>{getEventMeta(event)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

export function PlayerCard({ player }) {
  const detail = [player.team, player.section, player.positions?.join(', ')].filter(Boolean).join(' | ')

  return (
    <View style={styles.simpleCard}>
      <Text style={styles.simpleTitle}>
        {player.shirtNumber ? `${player.shirtNumber} ` : ''}{player.playerName}
      </Text>
      {detail ? <Text style={styles.simpleMeta}>{detail}</Text> : null}
      {player.parentEmail ? <Text style={styles.simpleMeta}>{player.parentEmail}</Text> : null}
    </View>
  )
}

export function SessionCard({ session }) {
  const detail = [session.sessionDate, session.sessionType, session.status].filter(Boolean).join(' | ')

  return (
    <View style={styles.simpleCard}>
      <Text style={styles.simpleTitle}>{session.title}</Text>
      {session.opponent ? <Text style={styles.simpleMeta}>Opponent: {session.opponent}</Text> : null}
      {detail ? <Text style={styles.simpleMeta}>{detail}</Text> : null}
    </View>
  )
}

export function MessageCard({ isBusy = false, message, onMarkRead }) {
  return (
    <View style={styles.simpleCard}>
      <View style={styles.matchHeader}>
        <Text style={styles.simpleTitle}>{message.subject}</Text>
        {!message.readAt ? <Text style={styles.unreadPill}>Unread</Text> : null}
      </View>
      {message.senderName ? <Text style={styles.simpleMeta}>From {message.senderName}</Text> : null}
      {message.body ? <Text numberOfLines={4} style={styles.simpleBody}>{message.body}</Text> : null}
      {!message.readAt && onMarkRead ? (
        <PrimaryButton disabled={isBusy} onPress={() => onMarkRead(message)} variant="secondary">Mark Read</PrimaryButton>
      ) : null}
    </View>
  )
}

export function PollCard({ activeOptionId = '', isBusy = false, onVote, poll }) {
  const [showAllOptions, setShowAllOptions] = useState(false)
  const visibleOptions = showAllOptions ? poll.options : poll.options.slice(0, 4)

  return (
    <View style={styles.simpleCard}>
      <Text style={styles.simpleTitle}>{poll.title}</Text>
      {poll.description ? <Text style={styles.simpleBody}>{poll.description}</Text> : null}
      <View style={styles.optionList}>
        {visibleOptions.map((option) => (
          <Pressable
            disabled={isBusy}
            key={option.id}
            onPress={() => onVote?.(poll, option)}
            style={[styles.optionButton, activeOptionId === option.id ? styles.optionButtonActive : null]}
          >
            <Text style={[styles.optionText, activeOptionId === option.id ? styles.optionTextActive : null]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {poll.options.length > 4 ? (
        <PrimaryButton onPress={() => setShowAllOptions((currentValue) => !currentValue)} variant="secondary">
          {showAllOptions ? 'Show fewer options' : `Show all ${poll.options.length} options`}
        </PrimaryButton>
      ) : null}
    </View>
  )
}

export function StatusBanner({ message, onDismiss }) {
  if (!message) {
    return null
  }

  return (
    <View style={styles.statusBanner}>
      <Text style={styles.statusBannerText}>{message}</Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} style={styles.statusDismissButton}>
          <Text style={styles.statusDismissText}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function MobileSettingsPanel({
  biometricAvailable,
  biometricEnabled,
  config,
  isRegisteringPush,
  isUpdatingBiometrics,
  lastUpdatedAt,
  notificationCopy,
  notificationEnabled,
  onDisableNotifications,
  onEnableNotifications,
  onSignOut,
  onToggleBiometrics,
}) {
  return (
    <View style={styles.settingsList}>
      <View style={styles.simpleCard}>
        <Text style={styles.simpleTitle}>Notifications</Text>
        <Text style={styles.simpleBody}>{notificationCopy}</Text>
        <PrimaryButton loading={isRegisteringPush} onPress={onEnableNotifications}>
          {notificationEnabled ? 'Refresh notifications' : 'Enable notifications'}
        </PrimaryButton>
        {notificationEnabled ? (
          <PrimaryButton loading={isRegisteringPush} onPress={onDisableNotifications} variant="secondary">
            Disable notifications
          </PrimaryButton>
        ) : null}
      </View>

      <View style={styles.simpleCard}>
        <Text style={styles.simpleTitle}>Biometric unlock</Text>
        <Text style={styles.simpleBody}>
          {biometricAvailable ? 'Use your device security when reopening the app.' : 'No enrolled biometric security is available on this device.'}
        </Text>
        <PrimaryButton
          disabled={!biometricAvailable}
          loading={isUpdatingBiometrics}
          onPress={onToggleBiometrics}
          variant="secondary"
        >
          {biometricEnabled ? 'Disable biometric unlock' : 'Enable biometric unlock'}
        </PrimaryButton>
      </View>

      <View style={styles.simpleCard}>
        <Text style={styles.simpleTitle}>App access</Text>
        <Text style={styles.simpleBody}>{config.isUsable ? 'Connection ready' : 'Connection needs setup'}</Text>
        {lastUpdatedAt ? <Text style={styles.simpleBody}>Updated {formatLastUpdated(lastUpdatedAt)}</Text> : null}
        <PrimaryButton onPress={onSignOut} variant="secondary">Sign out</PrimaryButton>
      </View>
    </View>
  )
}

function formatLastUpdated(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TabRail({ activeTab, onChange, tabBasis = '30%', tabs }) {
  return (
    <View style={styles.tabRail}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[
            styles.tabButton,
            { flexBasis: tabBasis },
            activeTab === tab.key ? styles.activeTabButton : null,
          ]}
        >
          <View style={styles.tabContent}>
            <Text style={[styles.tabText, activeTab === tab.key ? styles.activeTabText : null]}>{tab.label}</Text>
            {tab.count > 0 ? (
              <Text style={[styles.tabBadge, activeTab === tab.key ? styles.activeTabBadge : null]}>{tab.count}</Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  )
}

export function LegalFooter() {
  return (
    <View style={styles.legalFooter}>
      <Text style={styles.legalFooterText}>Copyright 2026 Football Player.</Text>
      <Text style={styles.legalFooterText}>Powered by pulseslabs.online</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.55,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    padding: 20,
  },
  error: {
    color: '#ffb4b4',
    fontSize: 14,
    fontWeight: '800',
  },
  choiceButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  choiceButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  choiceGroup: {
    gap: 8,
  },
  choiceGroupCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 14,
    width: '100%',
  },
  choiceGroupTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  choiceLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  choiceLabelActive: {
    color: '#000000',
  },
  choiceMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  choiceMetaActive: {
    color: '#000000',
  },
  field: {
    gap: 8,
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  multilineInput: {
    minHeight: 104,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  kicker: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  legalFooter: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  legalFooterText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  logo: {
    height: 70,
    width: 70,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  loginScroll: {
    flexGrow: 1,
    padding: 20,
  },
  loginShell: {
    alignSelf: 'center',
    gap: 18,
    maxWidth: 620,
    width: '100%',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  eventList: {
    gap: 8,
    marginTop: 12,
  },
  eventListTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  eventRow: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  eventScore: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  eventText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  eventTitle: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '900',
  },
  correctionNotice: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  correctionNoticeText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  correctionText: {
    color: colors.accent,
  },
  livePill: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    color: '#000000',
  },
  matchCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  matchDate: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  matchHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  matchMeta: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  matchTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  pageCopy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
  },
  scoreText: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  simpleBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  simpleCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  emptyState: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 16,
    width: '100%',
  },
  simpleMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  simpleTitle: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '900',
  },
  settingsList: {
    gap: 12,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: screen.padding,
  },
  shell: {
    alignSelf: 'center',
    gap: 18,
    maxWidth: screen.maxWidth,
    width: '100%',
  },
  stepper: {
    gap: 8,
  },
  stepperButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 58,
  },
  stepperButtonText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  stepperControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  stepperValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    minWidth: 36,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  overviewAction: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  overviewButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  overviewLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  overviewPanel: {
    gap: 12,
  },
  overviewSummary: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
  secondaryButton: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: colors.text,
  },
  segmentButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  segmentButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: '#000000',
  },
  screenCopy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  screenTitle: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
    textAlign: 'center',
  },
  statCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minWidth: 140,
    padding: 16,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  statValue: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statusBanner: {
    backgroundColor: 'rgba(213, 255, 45, 0.12)',
    borderColor: colors.accent,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  statusBannerText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  statusDismissButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 36,
  },
  statusDismissText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  statusPill: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
    textTransform: 'uppercase',
  },
  activeTabBadge: {
    backgroundColor: '#000000',
    color: colors.accent,
  },
  activeTabButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  activeTabText: {
    color: '#000000',
  },
  tabBadge: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    color: '#000000',
    fontSize: 11,
    fontWeight: '900',
    minWidth: 20,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: 'center',
  },
  tabButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tabContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  tabRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  optionList: {
    gap: 8,
    marginTop: 4,
  },
  optionButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  optionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  optionTextActive: {
    color: '#000000',
  },
  unreadPill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    color: '#000000',
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
})
