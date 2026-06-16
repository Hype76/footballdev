import {
  canCreateEvaluation,
  canManageFormFields,
  canManageParentEmailTemplates,
  canManageTeamSettings,
  canManageUsers,
  canViewActivityLog,
  canViewBilling,
  canViewPlatformFeedback,
  isSuperAdmin,
} from './auth.js'
import { hasPlanFeature } from './plans.js'
import { isRecoveryPathVisible } from './recovery-phase.js'

function pushVisibleLink(links, user, link) {
  if (isRecoveryPathVisible(link.path, { user })) {
    links.push(link)
  }
}

export function getRoleQuickLinks(user) {
  if (!user) {
    return []
  }

  if (isSuperAdmin(user)) {
    const links = []
    pushVisibleLink(links, user, { label: 'Open Platform Admin', path: '/platform-admin', primary: true })
    pushVisibleLink(links, user, { label: 'Manage Clubs', path: '/platform-clubs' })
    pushVisibleLink(links, user, { label: 'Billing Options', path: '/platform-billing-options' })

    if (canViewPlatformFeedback(user)) {
      pushVisibleLink(links, user, { label: 'Platform Feedback', path: '/platform-feedback' })
    }

    pushVisibleLink(links, user, { label: 'Activity Log', path: '/activity-log' })

    return links
  }

  const links = []

  if (canManageTeamSettings(user)) {
    pushVisibleLink(links, user, { label: 'Manage Teams', path: '/teams', primary: true })
  }

  if (canManageUsers(user)) {
    pushVisibleLink(links, user, { label: 'Manage User Access', path: '/user-access', primary: links.length === 0 })
  }

  if (canCreateEvaluation(user)) {
    pushVisibleLink(links, user, { label: 'Sessions', path: '/sessions', primary: links.length === 0 })
    pushVisibleLink(links, user, { label: 'Players', path: '/players' })
    pushVisibleLink(links, user, { label: 'Development', path: '/assess-player' })
  }

  if (canManageFormFields(user) && hasPlanFeature(user, 'customFormFields')) {
    pushVisibleLink(links, user, { label: 'Development Fields', path: '/form-builder' })
  }

  if (canManageParentEmailTemplates(user) && hasPlanFeature(user, 'parentEmail')) {
    pushVisibleLink(links, user, { label: 'Email Templates', path: '/parent-email-templates' })
  }

  if (canViewActivityLog(user) && hasPlanFeature(user, 'auditLogs')) {
    pushVisibleLink(links, user, { label: 'Activity Log', path: '/activity-log' })
  }

  if (canViewBilling(user)) {
    pushVisibleLink(links, user, { label: 'Billing', path: '/billing' })
  }

  if (canViewPlatformFeedback(user)) {
    pushVisibleLink(links, user, { label: 'Platform Feedback', path: '/platform-feedback' })
  }

  pushVisibleLink(links, user, { label: 'Settings', path: '/user-settings' })

  return links
}

export function getRoleNextAction(user) {
  const links = getRoleQuickLinks(user)
  return links.find((link) => link.primary) ?? links[0] ?? null
}
