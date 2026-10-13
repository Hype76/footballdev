import { CAPABILITIES, getFeatureAccess } from '../../../src/lib/paywall-access.js'

export const COACH_TEMPLATE_MARKING_TYPES = Object.freeze([
  { value: 'score_1_10', label: 'Rating 1-10' }, { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' }, { value: 'yes_no', label: 'Yes / No' },
  { value: 'select', label: 'Dropdown' }, { value: 'traffic_light', label: 'Traffic light' },
])

export function canBuildCoachDevelopmentTemplate(user) {
  return Boolean(user?.id && user?.clubId && user?.activeTeamId && user.hasActivePlanAccess === true)
    && Number(user.roleRank) >= 50 && !['admin', 'parent_portal', 'super_admin'].includes(user.role)
    && getFeatureAccess({ ...user, teamId: user.activeTeamId }, CAPABILITIES.customDevelopmentFields).allowed
}

export function buildCoachDevelopmentTemplateField({ id, label, type = 'score_1_10', options = '', parentVisible = true, required = false } = {}, index = 0) {
  const name = String(label || '').trim()
  if (!id || !name || name.length > 120) throw new Error('Enter a field name of 1 to 120 characters.')
  if (!COACH_TEMPLATE_MARKING_TYPES.some(item => item.value === type)) throw new Error('Choose a valid marking type.')
  const choices = type === 'select' ? [...new Set((Array.isArray(options) ? options : String(options).split('\n')).map(item => String(item).trim()).filter(Boolean))]
    : type === 'score_1_10' ? Array.from({ length: 10 }, (_, i) => String(i + 1))
      : type === 'yes_no' ? ['Yes', 'No'] : type === 'traffic_light' ? ['Green', 'Amber', 'Red'] : []
  if (type === 'select' && (!choices.length || choices.length > 50 || choices.some(item => item.length > 100))) throw new Error('Add 1 to 50 dropdown options, each up to 100 characters.')
  return { id, label: name, type, options: choices, required: required === true, isEnabled: true, orderIndex: index,
    parentVisible: parentVisible === true, includeInProgressChart: type === 'score_1_10',
    metricKey: type === 'score_1_10' ? `custom.${id}` : '', categoryKey: type === 'score_1_10' ? 'custom' : '', categoryLabel: type === 'score_1_10' ? 'Custom' : '' }
}

export function validateCoachDevelopmentTemplate({ id, name, fields = [] } = {}) {
  const title = String(name || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) throw new Error('Start a new template before saving.')
  if (!title || title.length > 120) throw new Error('Enter a template name of 1 to 120 characters.')
  if (!Array.isArray(fields) || !fields.length || fields.length > 50) throw new Error('Save 1 to 50 fields before saving the template.')
  if (new Set(fields.map(field => field.id)).size !== fields.length) throw new Error('Each field needs its own identity.')
  return { id, name: title, fields: fields.map((field, index) => buildCoachDevelopmentTemplateField(field, index)) }
}
