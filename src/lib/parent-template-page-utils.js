import { getDefaultClubParentEmailTemplates } from './supabase.js'

export function mergeParentEmailTemplates(savedTemplates, audience) {
  const savedByKey = new Map(
    savedTemplates
      .filter((template) => template.audience === audience)
      .map((template) => [template.key, template]),
  )

  return getDefaultClubParentEmailTemplates(audience).map((defaultTemplate) => ({
    ...defaultTemplate,
    ...(savedByKey.get(defaultTemplate.key) ?? {}),
    audience,
  }))
}
