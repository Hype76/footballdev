import { useMemo } from 'react'
import { useAuth } from '../lib/auth.js'
import { TeamCoachReminderSettings } from '../components/coach-reminders/TeamCoachReminderSettings.jsx'
import { createTeamCoachReminderSettingsStore } from '../lib/team-coach-reminder-settings-store.js'
import { requestOwnTeamCoachReminderPolicy } from '../lib/domain/coach-reminder-settings.js'

export function CoachReminderSettingsPage() {
  const { user } = useAuth()
  const store = useMemo(() => createTeamCoachReminderSettingsStore({ clubId:user?.clubId,teamId:user?.activeTeamId,request:requestOwnTeamCoachReminderPolicy }),[user?.clubId,user?.activeTeamId])
  if (import.meta.env.VITE_ENABLE_COACH_REMINDER_POLICY_SETTINGS !== 'true') return <p>Team reminder settings are not available yet.</p>
  if (!user?.activeTeamId || Number(user.roleRank) < 20 || ['parent_portal','super_admin','adult_player'].includes(user.role)) return <p>Choose an authorised team Coach workspace to manage reminders.</p>
  return <main className="mx-auto max-w-2xl space-y-4 px-4 py-6"><h1 className="text-xl font-bold">Team reminders</h1><TeamCoachReminderSettings key={`${user.clubId}:${user.activeTeamId}`} store={store} /></main>
}
