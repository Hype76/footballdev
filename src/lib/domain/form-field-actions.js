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
  const role = String(user?.role ?? '').trim()

  if (
    !user?.clubId ||
    !user.activeTeamId ||
    Number(user.roleRank ?? 0) < 20 ||
    role === 'admin' ||
    role === 'parent_portal' ||
    role === 'super_admin'
  ) {
    throw new Error('Team-level staff access is required to manage development fields.')
  }
}

function assertActiveTeamField(user, field = {}) {
  const activeTeamId = String(user?.activeTeamId ?? '').trim()
  const fieldTeamId = String(field?.teamId ?? field?.team_id ?? '').trim()

  if (!fieldTeamId) {
    if (field?.isDefault || field?.is_default) {
      throw new Error('Default development fields cannot be changed from team-level access.')
    }

    if (!activeTeamId) {
      throw new Error('Choose your current team before changing this field.')
    }

    return
  }

  if (!activeTeamId || fieldTeamId !== activeTeamId) {
    throw new Error('Development fields can only be managed for your current team.')
  }
}

export async function getConfiguredFormFields({ user } = {}) {
  if (!user?.clubId) {
    return []
  }

  const loadConfiguredFields = async () => {
    let query = supabase
      .from('form_fields')
      .select('*')
      .eq('club_id', user.clubId)
      .order('order_index', { ascending: true })

    if (user.activeTeamId) {
      query = query.or(`team_id.is.null,team_id.eq.${user.activeTeamId}`)
    } else {
      query = query.eq('is_default', true)
    }

    const { data, error } = await query

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
  const teamScopedField = {
    ...field,
    teamId: user.activeTeamId,
  }
  assertActiveTeamField(user, teamScopedField)
  const payload = mapFormFieldToRow(
    {
      ...teamScopedField,
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

  const { data: existingField, error: existingFieldError } = await supabase
    .from('form_fields')
    .select('id, team_id, is_default, type')
    .eq('id', id)
    .single()

  if (existingFieldError) {
    console.error(existingFieldError)
    throw existingFieldError
  }

  if (existingField?.is_default) {
    throw new Error('Default development fields cannot be edited from team-level access.')
  }

  assertActiveTeamField(user, existingField)

  let safeFieldData = {
    ...fieldData,
    teamId: existingField.team_id ?? user.activeTeamId,
  }

  if (fieldData?.includeInProgressChart !== undefined && fieldData.type === undefined) {
    safeFieldData = {
      ...safeFieldData,
      type: existingField?.type,
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

  const { data: existingField, error: existingFieldError } = await supabase
    .from('form_fields')
    .select('id, team_id, is_default')
    .eq('id', id)
    .single()

  if (existingFieldError) {
    console.error(existingFieldError)
    throw existingFieldError
  }

  if (existingField?.is_default) {
    throw new Error('Default development fields cannot be deleted.')
  }

  assertActiveTeamField(user, existingField)

  if (!existingField.team_id) {
    const adoptionPayload = mapFormFieldToRow(
      {
        teamId: user.activeTeamId,
      },
      user,
    )
    const { error: adoptionError } = await supabase
      .from('form_fields')
      .update(adoptionPayload)
      .eq('id', id)

    if (adoptionError) {
      console.error(adoptionError)
      throw adoptionError
    }
  }

  const { error } = await supabase.from('form_fields').delete().eq('id', id).eq('team_id', user.activeTeamId)

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
    fields.filter((field) => !field.isDefault).map((field, index) =>
      updateFormField(
        field.id,
        {
          ...field,
          clubId: field.clubId ?? user?.clubId ?? '',
          teamId: user?.activeTeamId ?? '',
          orderIndex: index + 1,
        },
        user,
      ),
    ),
  )
}
