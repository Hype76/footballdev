import { getDefaultClubParentEmailTemplates } from './supabase.js'

export function mergeParentEmailTemplates(savedTemplates, audience) {
  const defaultTemplates = getDefaultClubParentEmailTemplates(audience)
  const defaultKeys = new Set(defaultTemplates.map((template) => template.key))
  const savedByKey = new Map(
    savedTemplates
      .filter((template) => template.audience === audience)
      .map((template) => [template.key, template]),
  )
  const customTemplates = savedTemplates
    .filter((template) => template.audience === audience && !defaultKeys.has(template.key))
    .map((template) => ({
      ...template,
      audience,
      isCustom: true,
    }))

  return [
    ...defaultTemplates.map((defaultTemplate) => ({
      ...defaultTemplate,
      ...(savedByKey.get(defaultTemplate.key) ?? {}),
      audience,
      isCustom: false,
    })),
    ...customTemplates,
  ]
}

export function createCustomParentEmailTemplate({ audience, existingTemplates = [] }) {
  const existingKeys = new Set(existingTemplates.map((template) => String(template.key ?? '').trim()).filter(Boolean))
  let index = existingKeys.size + 1
  let key = `custom-${index}`

  while (existingKeys.has(key)) {
    index += 1
    key = `custom-${index}`
  }

  return {
    key,
    audience,
    label: `Custom Template ${index}`,
    subject: '',
    body: '',
    isEnabled: true,
    isCustom: true,
    sectionAvailability: ['Trial', 'Squad'],
    orderIndex: index + 10,
  }
}
