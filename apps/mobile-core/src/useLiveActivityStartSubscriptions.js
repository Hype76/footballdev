import { useEffect } from 'react'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { AppState, Platform } from 'react-native'
import { supabase } from './supabase'
import { getScopedTeamBranding, loadTeamBrandingDisplay } from '../../../src/lib/team-branding-display.js'

const iosActivity = Platform.OS === 'ios' ? requireOptionalNativeModule('ReactNativeWidgetExtension') : null

async function startToken() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const token = iosActivity?.getPushToStartToken?.()
    if (token) return token
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return ''
}

export function useLiveActivityStartSubscriptions(role, scopes, accountId) {
  const scopeKey = JSON.stringify(scopes)
  useEffect(() => {
    const registeredScopes = JSON.parse(scopeKey)
    if (Platform.OS !== 'ios' || !accountId || !['coach', 'parent'].includes(role) || !registeredScopes.length
      || !iosActivity?.activitiesEnabled?.()) return undefined
    let active = true
    let running = false
    let previousToken = ''
    const register = async () => {
      if (running) return
      running = true
      try {
        const { data } = await supabase.auth.getUser()
        if (!active || data?.user?.id !== accountId) return
        const token = await startToken()
        if (!active || !token) return
        if (token === previousToken) return
        let retry = false
        for (const scope of registeredScopes) {
          if (!active) break
          if (!scope.id || !['team', 'parent_link', 'fan_connection'].includes(scope.type)) continue
          let logoUrl = scope.logoUrl || ''
          if (!logoUrl && scope.teamId && scope.clubId) {
            const context = await loadTeamBrandingDisplay(supabase, { teamId: scope.teamId, clubId: scope.clubId }).catch(() => null)
            logoUrl = getScopedTeamBranding(context)?.logoUrl || ''
          }
          const badgeData = logoUrl ? await iosActivity.getMatchBadgeData(logoUrl).catch(() => null) : null
          const result = await supabase.rpc('register_live_activity_start_subscription', {
            app_role_value: role, scope_type_value: scope.type, scope_id_value: scope.id,
            start_token_value: token, badge_data_value: badgeData,
          })
          if (result.error && result.error.code !== '42501') retry = true
        }
        if (!retry) previousToken = token
      } finally { running = false }
    }
    void register().catch(() => {})
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void register().catch(() => {})
    })
    const timer = setInterval(() => { void register().catch(() => {}) }, 60000)
    return () => { active = false; listener.remove(); clearInterval(timer) }
  }, [role, scopeKey, accountId])
}
