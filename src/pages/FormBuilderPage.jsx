import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageFormFields, useAuth } from '../lib/auth.js'
import {
  addFormField,
  deleteFormField,
  getConfiguredFormFields,
  reorderFormFields,
} from '../lib/supabase.js'

const initialFieldForm = {
  label: '',
  type: 'text',
  required: false,
  options: '',
}

function normalizeOptions(optionsText) {
  return optionsText
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
}

export function FormBuilderPage() {
  const { user } = useAuth()
  const [fields, setFields] = useState([])
  const [fieldForm, setFieldForm] = useState(initialFieldForm)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadFields = async () => {
      setIsLoading(true)

      try {
        const nextFields = await getConfiguredFormFields({ user })

        if (!isMounted) {
          return
        }

        setFields(nextFields)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setFields([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadFields()
    }

    return () => {
      isMounted = false
    }
  }, [user])

  if (!canManageFormFields(user)) {
    return <Navigate to="/dashboard" replace />
  }

  const handleFormChange = (event) => {
    const { name, value, type, checked } = event.target
    setFieldForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const handleAddField = async (event) => {
    event.preventDefault()
    setIsSaving(true)

    try {
      const createdField = await addFormField({
        user,
        field: {
          ...fieldForm,
          options: fieldForm.type === 'select' ? normalizeOptions(fieldForm.options) : [],
          orderIndex: fields.length + 1,
          isDefault: false,
        },
      })

      setFields((current) => [...current, createdField].sort((left, right) => left.orderIndex - right.orderIndex))
      setFieldForm(initialFieldForm)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteField = async (fieldId) => {
    setIsSaving(true)

    try {
      await deleteFormField(fieldId)
      const nextFields = fields
        .filter((field) => field.id !== fieldId)
        .map((field, index) => ({
          ...field,
          orderIndex: index + 1,
        }))

      await reorderFormFields(nextFields, user)
      setFields(nextFields)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleMoveField = async (fieldId, direction) => {
    const currentIndex = fields.findIndex((field) => field.id === fieldId)
    const nextIndex = currentIndex + direction

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= fields.length) {
      return
    }

    const nextFields = [...fields]
    const [movedField] = nextFields.splice(currentIndex, 1)
    nextFields.splice(nextIndex, 0, movedField)

    const normalizedFields = nextFields.map((field, index) => ({
      ...field,
      orderIndex: index + 1,
    }))

    setIsSaving(true)

    try {
      await reorderFormFields(normalizedFields, user)
      setFields(normalizedFields)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Form Builder"
        title="Configure evaluation fields"
        description="Define the custom fields your club wants to capture on every evaluation."
      />

      <SectionCard
        title="Add field"
        description="Create text, textarea, number, or select fields for your club form."
      >
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleAddField}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Label</span>
            <input
              type="text"
              name="label"
              value={fieldForm.label}
              onChange={handleFormChange}
              required
              className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Type</span>
            <select
              name="type"
              value={fieldForm.type}
              onChange={handleFormChange}
              className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            >
              <option value="text">Text</option>
              <option value="textarea">Textarea</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
            </select>
          </label>

          {fieldForm.type === 'select' ? (
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Options</span>
              <input
                type="text"
                name="options"
                value={fieldForm.options}
                onChange={handleFormChange}
                placeholder="Option A, Option B, Option C"
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>
          ) : null}

          <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[#dbe3d6] bg-[#fcfdfb] px-4 py-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              name="required"
              checked={fieldForm.required}
              onChange={handleFormChange}
              className="h-4 w-4 rounded border-[#bfcab8] text-slate-900"
            />
            <span>Required field</span>
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500 sm:w-auto"
            >
              {isSaving ? 'Saving...' : 'Add field'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Current fields"
        description="Reorder or remove the fields used in your club evaluation form."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#f8faf7] px-4 py-4 text-sm text-slate-600">
            Loading fields...
          </div>
        ) : fields.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[#cfd8c9] bg-[#f7faf5] px-4 py-6 text-sm text-slate-600">
            No custom fields yet. Coaches will see the default evaluation form until you add club-specific fields.
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="flex flex-col gap-4 rounded-[20px] border border-[#dbe3d6] bg-[#fcfdfb] p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{field.label}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Type: {field.type}
                    {field.required ? ' | Required' : ' | Optional'}
                    {field.type === 'select' && field.options.length > 0 ? ` | ${field.options.join(', ')}` : ''}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={isSaving || index === 0}
                    onClick={() => handleMoveField(field.id, -1)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    disabled={isSaving || index === fields.length - 1}
                    onClick={() => handleMoveField(field.id, 1)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleDeleteField(field.id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
