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

export function getRoleQuickLinks(user) {
  if (!user) {
    return []
  }

  if (isSuperAdmin(user)) {
    return [
      { label: 'Open Platform Admin', path: '/platform-admin', primary: true },
      { label: 'Manage Clubs', path: '/platform-clubs' },
      { label: 'Billing Options', path: '/platform-billing-options' },
      ...(canViewPlatformFeedback(user) ? [{ label: 'Platform Feedback', path: '/platform-feedback' }] : []),
      { label: 'Activity Log', path: '/activity-log' },
    ]
  }

  const links = []

  if (canManageTeamSettings(user)) {
    links.push({ label: 'Manage Teams', path: '/teams', primary: true })
  }

  if (canManageUsers(user)) {
    links.push({ label: 'Manage User Access', path: '/user-access', primary: links.length === 0 })
  }

  if (canCreateEvaluation(user)) {
    links.push(
      { label: 'Sessions', path: '/sessions', primary: links.length === 0 },
      { label: 'Players', path: '/players' },
      { label: 'Development', path: '/assess-player' },
    )
  }

  if (canManageFormFields(user) && hasPlanFeature(user, 'customFormFields')) {
    links.push({ label: 'Development Fields', path: '/form-builder' })
  }

  if (canManageParentEmailTemplates(user) && hasPlanFeature(user, 'parentEmail')) {
    links.push({ label: 'Email Templates', path: '/parent-email-templates' })
  }

  if (canViewActivityLog(user) && hasPlanFeature(user, 'auditLogs')) {
    links.push({ label: 'Activity Log', path: '/activity-log' })
  }

  if (canViewBilling(user)) {
    links.push({ label: 'Billing', path: '/billing' })
  }

  if (canViewPlatformFeedback(user)) {
    links.push({ label: 'Platform Feedback', path: '/platform-feedback' })
  }

  links.push({ label: 'Settings', path: '/user-settings' })

  return links
}

export function getRoleNextAction(user) {
  const links = getRoleQuickLinks(user)
  return links.find((link) => link.primary) ?? links[0] ?? null
}
