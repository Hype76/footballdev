import { supabase } from '../supabase-client.js'
import {
  isParentPortalActivityCategory,
  normalizeParentPortalActivityState,
  toParentPortalActivityMap,
} from '../parent-portal-activity.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function getParentPortalActivityState({ parentLinkId } = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)
  if (!normalizedParentLinkId) {
    return {}
  }

  const { data, error } = await supabase.rpc('get_parent_portal_activity_state', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return toParentPortalActivityMap(data)
}

export async function markParentPortalCategoryViewed({
  categoryKey,
  observedActivityAt,
  parentLinkId,
} = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)
  const normalizedCategoryKey = normalizeText(categoryKey)
  const normalizedObservedActivityAt = normalizeText(observedActivityAt)

  if (!normalizedParentLinkId) {
    throw new Error('Choose a linked child before updating Parent Portal activity.')
  }

  if (!isParentPortalActivityCategory(normalizedCategoryKey)) {
    throw new Error('This Parent Portal activity category is not supported.')
  }

  if (!normalizedObservedActivityAt) {
    throw new Error('The category must load successfully before New can clear.')
  }

  const { data, error } = await supabase.rpc('mark_parent_portal_category_viewed', {
    category_key_value: normalizedCategoryKey,
    observed_activity_at_value: normalizedObservedActivityAt,
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const row = normalizeParentPortalActivityState(Array.isArray(data) ? data[0] : data)
  if (!row) {
    throw new Error('Parent Portal viewed state could not be confirmed.')
  }

  return row
}
