import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'
import {
  createMobileFormField,
  createMobilePlatformFeedback,
  createMobileSession,
  createMobileTeam,
  getMobileActivityLogs,
  getMobileArchivedPlayers,
  getMobileClubSettings,
  getMobileClubRoles,
  getMobileEmailTemplates,
  getMobileFormFields,
  getMobilePlatformFeedback,
  getMobileTeamStaffAssignments,
  getMobileTeams,
  getMobileUsers,
  replaceMobileTeamStaffAssignments,
  restoreMobilePlayer,
  updateMobileClubSettings,
  updateMobileClubUser,
  updateMobileFormField,
  updateMobileTeam,
  updateMobileUserProfile,
  upsertMobileEmailTemplate,
} from '../lib/data'
import { colors, spacing } from '../theme'

const routeConfig = {
  'create-session': {
    kicker: 'Sessions',
    title: 'Create Session',
    description: 'Set up a training or match assessment from mobile.',
  },
  'archived-players': {
    kicker: 'Players',
    title: 'Archived Players',
    description: 'Restore archived players when they need to return to active lists.',
  },
  'user-access': {
    kicker: 'Management',
    title: 'User Access',
    description: 'Review active club user access from mobile.',
  },
  'form-builder': {
    kicker: 'Assessment Fields',
    title: 'Assessment Fields',
    description: 'Review fields and add simple mobile-safe text fields.',
  },
  'parent-email-templates': {
    kicker: 'Templates',
    title: 'Email Templates',
    description: 'Review templates used by the web email workflow.',
  },
  'activity-log': {
    kicker: 'Audit',
    title: 'Activity Log',
    description: 'Review recent workspace activity.',
  },
  'club-settings': {
    kicker: 'Club',
    title: 'Club Settings',
    description: 'Update club name and contact details.',
  },
  'platform-feedback': {
    kicker: 'Feedback',
    title: 'Platform Feedback',
    description: 'Send product feedback from the app.',
  },
  information: {
    kicker: 'Information',
    title: 'Information',
    description: 'Account, role, and workspace guidance.',
  },
  settings: {
    kicker: 'Account',
    title: 'Settings',
    description: 'Update mobile account preferences.',
  },
}

function SegmentedOption({ active, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active ? styles.segmentActive : null]}>
      <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{label}</Text>
    </Pressable>
  )
}

function DataRow({ actionLabel, children, meta, onAction, title }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      {children}
      {onAction ? (
        <View style={styles.rowAction}>
          <Button onPress={onAction} variant="secondary">{actionLabel}</Button>
        </View>
      ) : null}
    </View>
  )
}

function EmptyState({ text = 'Nothing to show yet.' }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>No records found</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

export function ManageScreen({ routeKey, title, user, onBack }) {
  const config = routeConfig[routeKey] || { kicker: 'Workspace', title, description: '' }
  const [items, setItems] = useState([])
  const [teams, setTeams] = useState([])
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [userForm, setUserForm] = useState({ id: '', name: '', roleKey: '' })
  const [assignments, setAssignments] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [teamNameDraft, setTeamNameDraft] = useState('')
  const [staffSearch, setStaffSearch] = useState('')
  const [staffToAddId, setStaffToAddId] = useState('')
  const [clubSettings, setClubSettings] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sessionForm, setSessionForm] = useState({
    teamId: '',
    team: '',
    sessionType: 'training',
    opponent: '',
    sessionDate: new Date().toISOString().slice(0, 10),
  })
  const [teamForm, setTeamForm] = useState({ name: '', requireApproval: true })
  const [fieldForm, setFieldForm] = useState({ id: '', label: '', type: 'text', required: false, isEnabled: true })
  const [templateForm, setTemplateForm] = useState({
    id: '',
    key: '',
    teamId: '',
    audience: 'parent',
    label: '',
    subject: '',
    body: '',
    isEnabled: true,
  })
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [clubForm, setClubForm] = useState({ name: '', contactEmail: '', contactPhone: '', requireApproval: true })
  const [accountName, setAccountName] = useState(user?.name || '')

  const canManage = Number(user?.roleRank || 0) >= 50
  const isClubAdmin = user?.role === 'admin'
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || teams[0] || null
  const selectedTeamStaffIds = selectedTeam
    ? assignments.filter((assignment) => assignment.teamId === selectedTeam.id).map((assignment) => assignment.userId)
    : []
  const selectedTeamStaff = users.filter((member) => selectedTeamStaffIds.includes(member.id))
  const selectedTeamStaffEmails = new Set(selectedTeamStaff.map((member) => String(member.email || '').toLowerCase()).filter(Boolean))
  const availableStaff = users
    .filter((member) => !selectedTeamStaffIds.includes(member.id))
    .filter((member) => {
      const query = staffSearch.trim().toLowerCase()
      if (!query) {
        return true
      }

      return [member.name, member.email, member.roleLabel, member.role].some((value) => String(value || '').toLowerCase().includes(query))
    })

  const loader = useMemo(() => {
    const loaders = {
      'archived-players': () => getMobileArchivedPlayers(user),
      'user-access': () => getMobileUsers(user),
      'form-builder': () => getMobileFormFields(user),
      'activity-log': () => getMobileActivityLogs(user),
      'platform-feedback': () => getMobilePlatformFeedback(user),
    }
    return loaders[routeKey]
  }, [routeKey, user])

  const load = async () => {
    setIsLoading(true)
    setError('')

    try {
      if (routeKey === 'create-session' || routeKey === 'teams') {
        const nextTeams = await getMobileTeams(user)
        setTeams(nextTeams)
        setItems(nextTeams)
        if (routeKey === 'teams') {
          const [nextUsers, nextAssignments] = await Promise.all([
            canManage ? getMobileUsers(user) : Promise.resolve([]),
            canManage ? getMobileTeamStaffAssignments(user) : Promise.resolve([]),
          ])
          setUsers(nextUsers)
          setAssignments(nextAssignments)
          setSelectedTeamId((current) => current || nextTeams[0]?.id || '')
          setTeamNameDraft(nextTeams[0]?.name || '')
        }
        setSessionForm((current) => ({
          ...current,
          teamId: current.teamId || nextTeams[0]?.id || '',
          team: current.team || nextTeams[0]?.name || '',
        }))
      } else if (routeKey === 'club-settings') {
        const settings = await getMobileClubSettings(user)
        setClubSettings(settings)
        setClubForm(settings)
      } else if (routeKey === 'parent-email-templates') {
        const nextTeams = await getMobileTeams(user)
        const initialTeamId = templateForm.teamId || nextTeams[0]?.id || ''
        setTeams(nextTeams)
        setTemplateForm((current) => ({
          ...current,
          teamId: current.teamId || initialTeamId,
        }))
        setItems(await getMobileEmailTemplates(user, {
          teamId: initialTeamId,
          audience: templateForm.audience,
        }))
      } else if (routeKey === 'user-access') {
        const [nextUsers, nextRoles] = await Promise.all([
          getMobileUsers(user),
          getMobileClubRoles(user),
        ])
        setItems(nextUsers)
        setUsers(nextUsers)
        setRoles(nextRoles)
      } else if (loader) {
        setItems(await loader())
      } else {
        setItems([])
      }
    } catch (loadError) {
      console.error(loadError)
      setError(loadError.message || 'This view could not be loaded.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [routeKey])

  useEffect(() => {
    if (selectedTeam) {
      setTeamNameDraft(selectedTeam.name)
    }
  }, [selectedTeam?.id])

  const saveSession = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const created = await createMobileSession(user, sessionForm)
      setMessage(`${created.title} created.`)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Session could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveTeam = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const created = await createMobileTeam(user, teamForm)
      setTeamForm({ name: '', requireApproval: true })
      setItems((current) => [...current, created])
      setTeams((current) => [...current, created])
      setSelectedTeamId(created.id)
      setMessage(`${created.name} created.`)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Team could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleTeamApproval = async (team) => {
    setError('')
    setMessage('')

    try {
      const updated = await updateMobileTeam(user, team.id, { requireApproval: !team.requireApproval })
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setTeams((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setMessage(`${updated.name} updated.`)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Team could not be updated.')
    }
  }

  const saveTeamName = async () => {
    if (!selectedTeam) {
      return
    }

    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const updated = await updateMobileTeam(user, selectedTeam.id, { name: teamNameDraft })
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setTeams((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setMessage(`${updated.name} renamed.`)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Team could not be renamed.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveTeamStaff = async (nextStaffIds) => {
    if (!selectedTeam) {
      return
    }

    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const nextAssignments = await replaceMobileTeamStaffAssignments(user, selectedTeam.id, nextStaffIds)
      setAssignments((current) => [
        ...current.filter((assignment) => assignment.teamId !== selectedTeam.id),
        ...nextAssignments,
      ])
      setStaffToAddId('')
      setMessage('Team staff updated.')
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Team staff could not be updated.')
    } finally {
      setIsSaving(false)
    }
  }

  const addStaffToSelectedTeam = async () => {
    const member = users.find((staffMember) => staffMember.id === staffToAddId)
    const memberEmail = String(member?.email || '').toLowerCase()

    if (!member) {
      setError('Choose a staff member to add.')
      return
    }

    if (memberEmail && selectedTeamStaffEmails.has(memberEmail)) {
      setError('This email already has access to this team.')
      return
    }

    await saveTeamStaff([...selectedTeamStaffIds, member.id])
  }

  const removeStaffFromSelectedTeam = async (memberId) => {
    await saveTeamStaff(selectedTeamStaffIds.filter((staffId) => staffId !== memberId))
  }

  const restorePlayer = async (player) => {
    setError('')
    setMessage('')

    try {
      await restoreMobilePlayer(user, player.id)
      setItems((current) => current.filter((item) => item.id !== player.id))
      setMessage(`${player.playerName} restored.`)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Player could not be restored.')
    }
  }

  const saveField = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const saved = fieldForm.id
        ? await updateMobileFormField(user, fieldForm.id, fieldForm)
        : await createMobileFormField(user, fieldForm)
      setFieldForm({ id: '', label: '', type: 'text', required: false, isEnabled: true })
      setItems((current) => {
        const withoutSaved = current.filter((field) => field.id !== saved.id)
        return [...withoutSaved, saved].sort((left, right) => left.orderIndex - right.orderIndex || left.label.localeCompare(right.label))
      })
      setMessage(`${saved.label} saved.`)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Field could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const editField = (field) => {
    setFieldForm({
      id: field.id,
      label: field.label,
      type: ['text', 'textarea', 'score_1_5'].includes(field.type) ? field.type : 'text',
      required: field.required,
      isEnabled: field.isEnabled,
    })
    setMessage('')
    setError('')
  }

  const toggleFieldEnabled = async (field) => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const saved = await updateMobileFormField(user, field.id, {
        ...field,
        isEnabled: !field.isEnabled,
      })
      setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      setMessage(`${saved.label} ${saved.isEnabled ? 'enabled' : 'disabled'}.`)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Field could not be updated.')
    } finally {
      setIsSaving(false)
    }
  }

  const loadTemplatesForForm = async (nextForm = templateForm) => {
    const nextTemplates = await getMobileEmailTemplates(user, {
      teamId: nextForm.teamId,
      audience: nextForm.audience,
    })
    setItems(nextTemplates)
  }

  const updateTemplateTeam = async (teamId) => {
    const nextForm = { ...templateForm, teamId }
    setTemplateForm(nextForm)
    setError('')
    setMessage('')
    try {
      await loadTemplatesForForm(nextForm)
    } catch (loadError) {
      console.error(loadError)
      setError(loadError.message || 'Templates could not be loaded.')
    }
  }

  const updateTemplateAudience = async (audience) => {
    const nextForm = { ...templateForm, audience }
    setTemplateForm(nextForm)
    setError('')
    setMessage('')
    try {
      await loadTemplatesForForm(nextForm)
    } catch (loadError) {
      console.error(loadError)
      setError(loadError.message || 'Templates could not be loaded.')
    }
  }

  const editTemplate = (template) => {
    setTemplateForm({
      id: template.id,
      key: template.key,
      teamId: template.teamId || templateForm.teamId,
      audience: template.audience || 'parent',
      label: template.label,
      subject: template.subject,
      body: template.body,
      isEnabled: template.isEnabled,
    })
    setMessage('')
    setError('')
  }

  const resetTemplateForm = () => {
    setTemplateForm((current) => ({
      id: '',
      key: '',
      teamId: current.teamId,
      audience: current.audience,
      label: '',
      subject: '',
      body: '',
      isEnabled: true,
    }))
  }

  const saveTemplate = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const saved = await upsertMobileEmailTemplate(user, templateForm)
      setItems((current) => {
        const withoutSaved = current.filter((template) => template.id !== saved.id && template.key !== saved.key)
        return [...withoutSaved, saved].sort((left, right) => left.label.localeCompare(right.label))
      })
      setMessage(`${saved.label} saved.`)
      resetTemplateForm()
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Template could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveFeedback = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const created = await createMobilePlatformFeedback(user, feedbackMessage)
      setFeedbackMessage('')
      setItems((current) => [created, ...current])
      setMessage('Feedback sent.')
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Feedback could not be sent.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveClub = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const updated = await updateMobileClubSettings(user, clubForm)
      setClubSettings(updated)
      setClubForm(updated)
      setMessage('Club settings saved.')
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Club settings could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveAccount = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const updated = await updateMobileUserProfile(user, { name: accountName })
      setAccountName(updated.name)
      setMessage('Account settings saved.')
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Account settings could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const editUser = (member) => {
    setUserForm({
      id: member.id,
      name: member.name,
      roleKey: member.role,
    })
    setMessage('')
    setError('')
  }

  const clearUserForm = () => {
    setUserForm({ id: '', name: '', roleKey: '' })
  }

  const saveUserAccess = async () => {
    const member = users.find((item) => item.id === userForm.id)
    const role = roles.find((item) => item.roleKey === userForm.roleKey)

    if (!member) {
      setError('Choose a user to update.')
      return
    }

    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const updated = await updateMobileClubUser(user, member, {
        name: userForm.name,
        role: role || null,
      })
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setMessage(`${updated.name} updated.`)
      clearUserForm()
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'User access could not be updated.')
    } finally {
      setIsSaving(false)
    }
  }

  const chooseSessionTeam = (team) => {
    setSessionForm((current) => ({ ...current, teamId: team.id, team: team.name }))
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.webWrap}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topbar}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={styles.topbarTitle}>{config.title}</Text>
          </View>

          <View style={styles.shell}>
            <View style={styles.pageHeader}>
              <Text style={styles.kicker}>{config.kicker}</Text>
              <Text style={styles.title}>{config.title}</Text>
              {config.description ? <Text style={styles.description}>{config.description}</Text> : null}
            </View>

            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Loading {config.title.toLowerCase()}...</Text>
              </View>
            ) : null}

            {!isLoading && routeKey === 'create-session' ? (
              <View style={styles.card}>
                <Text style={styles.fieldLabel}>Session Type</Text>
                <View style={styles.segmentWrap}>
                  <SegmentedOption
                    active={sessionForm.sessionType === 'training'}
                    label="Training"
                    onPress={() => setSessionForm((current) => ({ ...current, sessionType: 'training', opponent: '' }))}
                  />
                  <SegmentedOption
                    active={sessionForm.sessionType === 'match'}
                    label="Match"
                    onPress={() => setSessionForm((current) => ({ ...current, sessionType: 'match' }))}
                  />
                </View>
                <Text style={styles.fieldLabel}>Team</Text>
                <View style={styles.optionList}>
                  {teams.map((team) => (
                    <Pressable
                      key={team.id}
                      onPress={() => chooseSessionTeam(team)}
                      style={[styles.option, sessionForm.teamId === team.id ? styles.optionActive : null]}
                    >
                      <Text style={[styles.optionText, sessionForm.teamId === team.id ? styles.optionTextActive : null]}>{team.name}</Text>
                    </Pressable>
                  ))}
                </View>
                {sessionForm.sessionType === 'match' ? (
                  <TextField
                    autoCapitalize="words"
                    label="Opponent"
                    onChangeText={(value) => setSessionForm((current) => ({ ...current, opponent: value }))}
                    placeholder="Opponent"
                    value={sessionForm.opponent}
                  />
                ) : null}
                <TextField
                  label="Session Date"
                  onChangeText={(value) => setSessionForm((current) => ({ ...current, sessionDate: value }))}
                  placeholder="YYYY-MM-DD"
                  value={sessionForm.sessionDate}
                />
                <Button disabled={isSaving || !sessionForm.teamId || !sessionForm.sessionDate} onPress={saveSession}>
                  {isSaving ? 'Creating...' : 'Create Session'}
                </Button>
              </View>
            ) : null}

            {!isLoading && routeKey === 'teams' ? (
              <>
                {canManage ? (
                  <View style={styles.card}>
                    <TextField
                      autoCapitalize="words"
                      label="Team Name"
                      onChangeText={(value) => setTeamForm((current) => ({ ...current, name: value }))}
                      placeholder="Team name"
                      value={teamForm.name}
                    />
                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.switchTitle}>Assessment approval</Text>
                        <Text style={styles.switchDescription}>Require approval for this team.</Text>
                      </View>
                      <Switch
                        onValueChange={(value) => setTeamForm((current) => ({ ...current, requireApproval: value }))}
                        value={teamForm.requireApproval}
                      />
                    </View>
                    <Button disabled={isSaving || !teamForm.name.trim()} onPress={saveTeam}>
                      {isSaving ? 'Creating...' : 'Create Team'}
                    </Button>
                  </View>
                ) : null}
                <View style={styles.list}>
                  {items.map((team) => (
                    <Pressable
                      key={team.id}
                      onPress={() => setSelectedTeamId(team.id)}
                      style={[styles.row, selectedTeam?.id === team.id ? styles.selectedRow : null]}
                    >
                      <Text style={styles.rowTitle}>{team.name}</Text>
                      <Text style={styles.rowMeta}>
                        {[
                          team.requireApproval ? 'Approval on' : 'Approval off',
                          `${assignments.filter((assignment) => assignment.teamId === team.id).length} staff allocated`,
                        ].join(' | ')}
                      </Text>
                    </Pressable>
                  ))}
                  {items.length === 0 ? <EmptyState text="No teams have been created yet." /> : null}
                </View>
                {selectedTeam && canManage ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Manage {selectedTeam.name}</Text>
                    <TextField
                      autoCapitalize="words"
                      label="Team Name"
                      onChangeText={setTeamNameDraft}
                      placeholder="Team name"
                      value={teamNameDraft}
                    />
                    <Button
                      disabled={isSaving || !teamNameDraft.trim() || teamNameDraft.trim() === selectedTeam.name}
                      onPress={saveTeamName}
                      variant="secondary"
                    >
                      {isSaving ? 'Saving...' : 'Save Team Name'}
                    </Button>
                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.switchTitle}>Assessment approval</Text>
                        <Text style={styles.switchDescription}>Require approval for this team.</Text>
                      </View>
                      <Switch
                        disabled={isSaving}
                        onValueChange={() => toggleTeamApproval(selectedTeam)}
                        value={selectedTeam.requireApproval}
                      />
                    </View>
                    <TextField
                      autoCapitalize="none"
                      label="Search Staff"
                      onChangeText={setStaffSearch}
                      placeholder="Name, email, or role"
                      value={staffSearch}
                    />
                    <View style={styles.optionList}>
                      {availableStaff.slice(0, 8).map((member) => (
                        <Pressable
                          key={member.id}
                          onPress={() => setStaffToAddId(member.id)}
                          style={[styles.option, staffToAddId === member.id ? styles.optionActive : null]}
                        >
                          <Text style={[styles.optionText, staffToAddId === member.id ? styles.optionTextActive : null]}>{member.name}</Text>
                          <Text style={styles.optionMeta}>{[member.email, member.roleLabel].filter(Boolean).join(' | ')}</Text>
                        </Pressable>
                      ))}
                      {availableStaff.length === 0 ? <Text style={styles.noticeText}>No available staff match this team.</Text> : null}
                    </View>
                    <Button disabled={isSaving || !staffToAddId} onPress={addStaffToSelectedTeam}>
                      {isSaving ? 'Saving...' : 'Add Staff To Team'}
                    </Button>
                    <View style={styles.divider} />
                    <Text style={styles.cardTitle}>Allocated Staff</Text>
                    <View style={styles.optionList}>
                      {selectedTeamStaff.map((member) => (
                        <View key={member.id} style={styles.staffRow}>
                          <View style={styles.switchText}>
                            <Text style={styles.rowTitle}>{member.name}</Text>
                            <Text style={styles.rowMeta}>{[member.email, member.roleLabel].filter(Boolean).join(' | ')}</Text>
                          </View>
                          <Pressable
                            disabled={isSaving}
                            onPress={() => removeStaffFromSelectedTeam(member.id)}
                            style={styles.smallButton}
                          >
                            <Text style={styles.smallButtonText}>Remove</Text>
                          </Pressable>
                        </View>
                      ))}
                      {selectedTeamStaff.length === 0 ? <Text style={styles.noticeText}>No staff are allocated to this team yet.</Text> : null}
                    </View>
                  </View>
                ) : null}
                {selectedTeam && !canManage ? (
                  <View style={styles.list}>
                    <DataRow title={selectedTeam.name} meta="Manager access is required to edit this team." />
                  </View>
                ) : null}
              </>
            ) : null}

            {!isLoading && routeKey === 'archived-players' ? (
              <View style={styles.list}>
                {items.map((player) => (
                  <DataRow
                    actionLabel="Restore"
                    key={player.id}
                    meta={[player.section, player.team].filter(Boolean).join(' | ')}
                    onAction={() => restorePlayer(player)}
                    title={player.playerName}
                  />
                ))}
                {items.length === 0 ? <EmptyState text="There are no archived players for this club." /> : null}
              </View>
            ) : null}

            {!isLoading && routeKey === 'user-access' ? (
              <>
                {canManage && userForm.id ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Edit User Access</Text>
                    <TextField
                      autoCapitalize="words"
                      label="Display Name"
                      onChangeText={(value) => setUserForm((current) => ({ ...current, name: value }))}
                      placeholder="Display name"
                      value={userForm.name}
                    />
                    <Text style={styles.fieldLabel}>Role</Text>
                    <View style={styles.optionList}>
                      {roles.map((role) => (
                        <Pressable
                          key={role.id || role.roleKey}
                          onPress={() => setUserForm((current) => ({ ...current, roleKey: role.roleKey }))}
                          style={[styles.option, userForm.roleKey === role.roleKey ? styles.optionActive : null]}
                        >
                          <Text style={[styles.optionText, userForm.roleKey === role.roleKey ? styles.optionTextActive : null]}>
                            {role.roleLabel}
                          </Text>
                          <Text style={styles.optionMeta}>Access level {role.roleRank}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Button disabled={isSaving || !userForm.name.trim()} onPress={saveUserAccess}>
                      {isSaving ? 'Saving...' : 'Save User'}
                    </Button>
                    <Button onPress={clearUserForm} variant="secondary">
                      Clear Form
                    </Button>
                  </View>
                ) : null}
                <View style={styles.list}>
                  {items.map((member) => (
                    <DataRow
                      actionLabel="Edit"
                      key={member.id}
                      meta={[member.email, member.roleLabel, member.status].filter(Boolean).join(' | ')}
                      onAction={canManage && member.id !== user?.id ? () => editUser(member) : null}
                      title={member.name}
                    />
                  ))}
                  {items.length === 0 ? <EmptyState text={canManage ? 'No users are visible.' : 'Manager access is required.'} /> : null}
                </View>
              </>
            ) : null}

            {!isLoading && routeKey === 'form-builder' ? (
              <>
                {canManage ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{fieldForm.id ? 'Edit Field' : 'New Field'}</Text>
                    <TextField
                      autoCapitalize="words"
                      label="Field Label"
                      onChangeText={(value) => setFieldForm((current) => ({ ...current, label: value }))}
                      placeholder="Field label"
                      value={fieldForm.label}
                    />
                    <Text style={styles.fieldLabel}>Field Type</Text>
                    <View style={styles.segmentWrap}>
                      <SegmentedOption
                        active={fieldForm.type === 'text'}
                        label="Text"
                        onPress={() => setFieldForm((current) => ({ ...current, type: 'text' }))}
                      />
                      <SegmentedOption
                        active={fieldForm.type === 'textarea'}
                        label="Notes"
                        onPress={() => setFieldForm((current) => ({ ...current, type: 'textarea' }))}
                      />
                      <SegmentedOption
                        active={fieldForm.type === 'score_1_5'}
                        label="Score"
                        onPress={() => setFieldForm((current) => ({ ...current, type: 'score_1_5' }))}
                      />
                    </View>
                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.switchTitle}>Required</Text>
                        <Text style={styles.switchDescription}>Mark this field as required.</Text>
                      </View>
                      <Switch
                        onValueChange={(value) => setFieldForm((current) => ({ ...current, required: value }))}
                        value={fieldForm.required}
                      />
                    </View>
                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.switchTitle}>Enabled</Text>
                        <Text style={styles.switchDescription}>Show this field during mobile assessments.</Text>
                      </View>
                      <Switch
                        onValueChange={(value) => setFieldForm((current) => ({ ...current, isEnabled: value }))}
                        value={fieldForm.isEnabled}
                      />
                    </View>
                    <Button disabled={isSaving || !fieldForm.label.trim()} onPress={saveField}>
                      {isSaving ? 'Saving...' : 'Save Field'}
                    </Button>
                    {fieldForm.id ? (
                      <Button onPress={() => setFieldForm({ id: '', label: '', type: 'text', required: false, isEnabled: true })} variant="secondary">
                        Clear Form
                      </Button>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.list}>{items.map((field) => (
                  <DataRow
                    actionLabel="Edit"
                    key={field.id}
                    meta={[
                      field.type,
                      field.required ? 'required' : 'optional',
                      field.isEnabled ? 'enabled' : 'disabled',
                      field.isDefault ? 'default' : 'custom',
                    ].join(' | ')}
                    onAction={canManage ? () => editField(field) : null}
                    title={field.label}
                  >
                    {canManage ? (
                      <View style={styles.rowAction}>
                        <Button onPress={() => toggleFieldEnabled(field)} variant="secondary">
                          {field.isEnabled ? 'Disable' : 'Enable'}
                        </Button>
                      </View>
                    ) : null}
                  </DataRow>
                ))}</View>
              </>
            ) : null}

            {!isLoading && routeKey === 'parent-email-templates' ? (
              <>
                {canManage ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{templateForm.id ? 'Edit Template' : 'New Template'}</Text>
                    <Text style={styles.fieldLabel}>Team</Text>
                    <View style={styles.optionList}>
                      {teams.map((team) => (
                        <Pressable
                          key={team.id}
                          onPress={() => updateTemplateTeam(team.id)}
                          style={[styles.option, templateForm.teamId === team.id ? styles.optionActive : null]}
                        >
                          <Text style={[styles.optionText, templateForm.teamId === team.id ? styles.optionTextActive : null]}>{team.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.fieldLabel}>Audience</Text>
                    <View style={styles.segmentWrap}>
                      <SegmentedOption
                        active={templateForm.audience === 'parent'}
                        label="Parent"
                        onPress={() => updateTemplateAudience('parent')}
                      />
                      <SegmentedOption
                        active={templateForm.audience === 'player'}
                        label="Player"
                        onPress={() => updateTemplateAudience('player')}
                      />
                    </View>
                    <TextField
                      autoCapitalize="words"
                      label="Template Name"
                      onChangeText={(value) => setTemplateForm((current) => ({ ...current, label: value }))}
                      placeholder="Template name"
                      value={templateForm.label}
                    />
                    <TextField
                      autoCapitalize="sentences"
                      label="Subject"
                      onChangeText={(value) => setTemplateForm((current) => ({ ...current, subject: value }))}
                      placeholder="Email subject"
                      value={templateForm.subject}
                    />
                    <TextField
                      autoCapitalize="sentences"
                      label="Message Body"
                      multiline
                      onChangeText={(value) => setTemplateForm((current) => ({ ...current, body: value }))}
                      placeholder="Email body"
                      value={templateForm.body}
                    />
                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.switchTitle}>Enabled</Text>
                        <Text style={styles.switchDescription}>Make this template available in the web email workflow.</Text>
                      </View>
                      <Switch
                        onValueChange={(value) => setTemplateForm((current) => ({ ...current, isEnabled: value }))}
                        value={templateForm.isEnabled}
                      />
                    </View>
                    <Button
                      disabled={isSaving || !templateForm.teamId || !templateForm.label.trim() || !templateForm.subject.trim() || !templateForm.body.trim()}
                      onPress={saveTemplate}
                    >
                      {isSaving ? 'Saving...' : 'Save Template'}
                    </Button>
                    {templateForm.id ? (
                      <Button onPress={resetTemplateForm} variant="secondary">
                        Clear Form
                      </Button>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.list}>
                  {items.map((template) => (
                    <DataRow
                      actionLabel="Edit"
                      key={template.id || template.key}
                      meta={[template.audience, template.isEnabled ? 'enabled' : 'disabled'].join(' | ')}
                      onAction={canManage ? () => editTemplate(template) : null}
                      title={template.label}
                    >
                      <Text style={styles.rowMeta}>{template.subject}</Text>
                      {template.body ? <Text style={styles.rowMeta}>{template.body.slice(0, 140)}</Text> : null}
                    </DataRow>
                  ))}
                  {items.length === 0 ? <EmptyState text="No templates are visible for the selected team." /> : null}
                </View>
              </>
            ) : null}

            {!isLoading && routeKey === 'activity-log' ? (
              <View style={styles.list}>
                {items.map((entry) => (
                  <DataRow key={entry.id} title={entry.action.replaceAll('_', ' ')} meta={[entry.entityType, entry.createdAt.slice(0, 10)].filter(Boolean).join(' | ')} />
                ))}
                {items.length === 0 ? <EmptyState text={canManage ? 'No activity is visible yet.' : 'Manager access is required.'} /> : null}
              </View>
            ) : null}

            {!isLoading && routeKey === 'club-settings' ? (
              <View style={styles.card}>
                <TextField
                  autoCapitalize="words"
                  label="Club Name"
                  onChangeText={(value) => setClubForm((current) => ({ ...current, name: value }))}
                  placeholder="Club name"
                  value={clubForm.name}
                />
                <TextField
                  keyboardType="email-address"
                  label="Contact Email"
                  onChangeText={(value) => setClubForm((current) => ({ ...current, contactEmail: value }))}
                  placeholder="club@example.com"
                  value={clubForm.contactEmail}
                />
                <TextField
                  keyboardType="phone-pad"
                  label="Contact Phone"
                  onChangeText={(value) => setClubForm((current) => ({ ...current, contactPhone: value }))}
                  placeholder="Phone"
                  value={clubForm.contactPhone}
                />
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchTitle}>Default approval</Text>
                    <Text style={styles.switchDescription}>Use approval by default for club teams.</Text>
                  </View>
                  <Switch
                    disabled={!isClubAdmin}
                    onValueChange={(value) => setClubForm((current) => ({ ...current, requireApproval: value }))}
                    value={clubForm.requireApproval}
                  />
                </View>
                {clubSettings && !isClubAdmin ? <Text style={styles.noticeText}>Club admin access is required to save changes.</Text> : null}
                <Button disabled={isSaving || !isClubAdmin || !clubForm.name.trim()} onPress={saveClub}>
                  {isSaving ? 'Saving...' : 'Save Club Settings'}
                </Button>
              </View>
            ) : null}

            {!isLoading && routeKey === 'platform-feedback' ? (
              <>
                <View style={styles.card}>
                  <TextField
                    autoCapitalize="sentences"
                    label="Feedback"
                    onChangeText={setFeedbackMessage}
                    placeholder="What should improve?"
                    value={feedbackMessage}
                  />
                  <Button disabled={isSaving || !feedbackMessage.trim()} onPress={saveFeedback}>
                    {isSaving ? 'Sending...' : 'Send Feedback'}
                  </Button>
                </View>
                <View style={styles.list}>{items.map((feedback) => (
                  <DataRow key={feedback.id} title={feedback.message} meta={[feedback.status, feedback.createdAt.slice(0, 10)].filter(Boolean).join(' | ')}>
                    {feedback.adminNote ? <Text style={styles.rowMeta}>{feedback.adminNote}</Text> : null}
                  </DataRow>
                ))}</View>
              </>
            ) : null}

            {!isLoading && routeKey === 'information' ? (
              <View style={styles.list}>
                <DataRow title="Account" meta={[user?.name, user?.email].filter(Boolean).join(' | ')} />
                <DataRow title="Role" meta={[user?.roleLabel || user?.role, user?.activeTeamName || user?.clubName].filter(Boolean).join(' | ')} />
                <DataRow title="Mobile access" meta="Billing and payment management are excluded from this app." />
              </View>
            ) : null}

            {!isLoading && routeKey === 'settings' ? (
              <View style={styles.card}>
                <TextField
                  autoCapitalize="words"
                  label="Display Name"
                  onChangeText={setAccountName}
                  placeholder="Display name"
                  value={accountName}
                />
                <Button disabled={isSaving || !accountName.trim()} onPress={saveAccount}>
                  {isSaving ? 'Saving...' : 'Save Account'}
                </Button>
              </View>
            ) : null}

            {message ? <Text style={styles.message}>{message}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button onPress={onBack} variant="secondary">
              Back To Home
            </Button>
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
    gap: 14,
    marginTop: 12,
    padding: spacing.card,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 23,
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
  },
  emptyCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 20,
    marginVertical: 12,
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
  list: {
    gap: 12,
    marginVertical: 12,
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
    marginVertical: 12,
  },
  noticeText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  option: {
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  optionActive: {
    backgroundColor: colors.sidebarActive,
    borderColor: colors.accent,
  },
  optionList: {
    gap: 8,
  },
  optionText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  optionTextActive: {
    color: colors.text,
  },
  optionMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 3,
  },
  pageHeader: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  row: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  rowAction: {
    marginTop: 12,
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 7,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    padding: Platform.OS === 'web' ? 10 : 0,
    paddingBottom: 36,
  },
  selectedRow: {
    backgroundColor: colors.sidebarActive,
    borderColor: colors.accent,
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
  },
  segmentActive: {
    backgroundColor: colors.sidebarActive,
    borderColor: colors.accent,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: colors.text,
  },
  segmentWrap: {
    flexDirection: 'row',
    gap: 10,
  },
  shell: {
    backgroundColor: colors.shell,
    borderColor: colors.border,
    borderRadius: Platform.OS === 'web' ? 8 : 0,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    padding: 12,
  },
  smallButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  smallButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  staffRow: {
    alignItems: 'center',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  switchDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  switchRow: {
    alignItems: 'center',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  switchText: {
    flex: 1,
  },
  switchTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
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
