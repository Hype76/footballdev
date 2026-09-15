import { getResourceDisplayTitle, sortResourcesNewestFirst } from '../../../src/lib/resource-date-presentation.js'

export const COACH_RESOURCE_CATEGORIES = Object.freeze([
  { value: 'general', label: 'General' }, { value: 'training', label: 'Training' },
  { value: 'match_day', label: 'Match day' }, { value: 'development', label: 'Development' },
  { value: 'admin', label: 'Admin' },
])

export function groupCoachResources(resources = [], search = '') {
  const needle = search.trim().toLowerCase()
  const groups = new Map()
  for (const resource of sortResourcesNewestFirst(resources)) {
    const category = resource.category || 'general'
    const label = COACH_RESOURCE_CATEGORIES.find(item => item.value === category)?.label || category.replaceAll('_', ' ')
    if (needle && ![getResourceDisplayTitle(resource), resource.description, label, resource.originalFilename].some(value => String(value || '').toLowerCase().includes(needle))) continue
    if (!groups.has(category)) groups.set(category, { category, label, resources: [] })
    groups.get(category).resources.push(resource)
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
}
