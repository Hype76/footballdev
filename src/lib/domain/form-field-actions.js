import { supabase } from '../supabase-client.js'
import { hasPlanFeature } from '../plans.js'
import { blockDemoMutation, isDemoAccountValue } from './demo-guards.js'
import { getDefaultFormFields } from './core-defaults.js'
import {
  getEntryUserEmail,
  getEntryUserId,
  getEntryUserName,
} from './core-normalizers.js'
import {
  mapFormFieldToRow,
  normalizeFormFieldRow,
} from './form-field-normalizers.js'
import { seedDefaultFormFields } from './core-seeding.js'
import { assertClubFeature } from './plan-gates.js'

function assertFormFieldManager(user) {
  if (
    !user?.clubId ||
    user.role !== 'head_manager' ||
    !user.activeTeamId ||
    user.role === 'parent_portal' ||
    user.role === 'super_admin'
  ) {
    throw new Error('Team Admin access is required to manage development fields.')
  }
}

export async function getConfiguredFormFields({ user } = {}) {
  if (!user?.clubId) {
    return []
  }

  const loadConfiguredFields = async () => {
    const { data, error } = await supabase
      .from('form_fields')
      .select('*')
      .eq('club_id', user.clubId)
      .order('order_index', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeFormFieldRow)
  }

  const configuredFields = await loadConfiguredFields()

  if (configuredFields.length > 0) {
    return configuredFields
  }

  if (isDemoAccountValue(user)) {
    return []
  }

  await seedDefaultFormFields()
  return loadConfiguredFields()
}

export async function getFormFields({ user } = {}) {
  if (user && !hasPlanFeature(user, 'customFormFields')) {
    return {
      fields: getDefaultFormFields(),
      isFallback: true,
    }
  }

  try {
    const configuredFields = await getConfiguredFormFields({ user })

    if (configuredFields.length > 0) {
      return {
        fields: configuredFields,
        isFallback: false,
      }
    }
  } catch (error) {
    console.error(error)
  }

  return {
    fields: getDefaultFormFields(),
    isFallback: true,
  }
}

export async function addFormField({ user, field }) {
  await blockDemoMutation(user)
  assertFormFieldManager(user)
  await assertClubFeature({
    user,
    clubId: user?.clubId,
    featureName: 'customFormFields',
  })

  const nextOrderIndex = Number(field.orderIndex ?? Date.now())
  const payload = mapFormFieldToRow(
    {
      ...field,
      createdBy: getEntryUserId(user),
      createdByName: getEntryUserName(user),
      createdByEmail: getEntryUserEmail(user),
    },
    user,
    nextOrderIndex,
  )
  const { data, error } = await supabase.from('form_fields').insert(payload).select('*').single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeFormFieldRow(data)
}

export async function updateFormField(id, fieldData, user) {
  await blockDemoMutation(user)
  assertFormFieldManager(user)
  await assertClubFeature({
    user,
    clubId: user?.clubId ?? fieldData?.clubId,
    featureName: 'customFormFields',
  })

  let safeFieldData = fieldData

  if (fieldData?.includeInProgressChart !== undefined && fieldData.type === undefined) {
    const { data: currentField, error: currentFieldError } = await supabase
      .from('form_fields')
      .select('type')
      .eq('id', id)
      .maybeSingle()

    if (currentFieldError) {
      console.error(currentFieldError)
      throw currentFieldError
    }

    safeFieldData = {
      ...fieldData,
      type: currentField?.type,
    }
  }

  const payload = mapFormFieldToRow(
    safeFieldData,
    user,
    safeFieldData.orderIndex !== undefined ? Number(safeFieldData.orderIndex) : undefined,
  )
  const { data: updatedRow, error } = await supabase
    .from('form_fields')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeFormFieldRow(updatedRow)
}

export async function deleteFormField(id, user = null) {
  await blockDemoMutation(user)
  assertFormFieldManager(user)
  await assertClubFeature({
    user,
    clubId: user?.clubId,
    featureName: 'customFormFields',
  })

  const { error } = await supabase.from('form_fields').delete().eq('id', id)

  if (error) {
    console.error(error)
    throw error
  }
}

export async function reorderFormFields(fields, user) {
  await blockDemoMutation(user)
  assertFormFieldManager(user)
  await assertClubFeature({
    user,
    clubId: user?.clubId,
    featureName: 'customFormFields',
  })

  await Promise.all(
    fields.map((field, index) =>
      updateFormField(
        field.id,
        {
          ...field,
          clubId: field.clubId ?? user?.clubId ?? '',
          orderIndex: index + 1,
        },
        user,
      ),
    ),
  )
}
