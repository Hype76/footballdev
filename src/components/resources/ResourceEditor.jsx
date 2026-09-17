import { useId, useState } from 'react'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm text-[#101828] disabled:opacity-60'
const actionClass = 'min-h-11 px-4 py-2 text-sm font-black text-[#047857] disabled:opacity-60'

export function ResourceEditor({ resource, categories, fileAccept, isSaving, error, onSave, onCancel }) {
  const [originalResource] = useState(resource)
  const fieldId = useId()
  const [draft, setDraft] = useState(() => ({ title: resource.title, description: resource.description || '', category: resource.category, externalUrl: resource.externalUrl || '', file: null }))
  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }))

  return (
    <form aria-label="Edit resource" className="mt-4 space-y-3 border-t border-[#d7e5dc] pt-4" onSubmit={event => { event.preventDefault(); if (!isSaving) void onSave(originalResource, draft) }}>
      <h3 className="text-lg font-black">Edit resource</h3>
      <p className="text-sm">Existing player assignments and sharing settings will stay the same.</p>
      <fieldset disabled={isSaving} className="space-y-3">
        <label className="block text-sm font-bold">Title
          <input autoFocus required maxLength={120} value={draft.title} onChange={event => update('title', event.target.value)} className={fieldClass} />
        </label>
        <div className="text-sm font-bold"><label htmlFor={`${fieldId}-category`}>Category</label>
          <select id={`${fieldId}-category`} value={draft.category} onChange={event => update('category', event.target.value)} className={fieldClass}>
            {categories.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
          </select>
        </div>
        <div className="text-sm font-bold"><label htmlFor={`${fieldId}-description`}>Description</label>
          <textarea id={`${fieldId}-description`} maxLength={1000} value={draft.description} onChange={event => update('description', event.target.value)} className={fieldClass} />
        </div>
        {resource.resourceType === 'external_link' ? (
          <label className="block text-sm font-bold">Resource link
            <input required type="url" maxLength={2048} value={draft.externalUrl} onChange={event => update('externalUrl', event.target.value)} className={fieldClass} />
          </label>
        ) : (
          <label className="block text-sm font-bold">Replace file (optional)
            <span className="block break-words font-normal">Current file: {resource.originalFilename}. Leave blank to keep it.</span>
            <input type="file" accept={fileAccept} onChange={event => update('file', event.target.files?.[0] || null)} className={fieldClass} />
          </label>
        )}
      </fieldset>
      {error ? <p role="alert" className="text-sm font-bold text-red-700">{error}</p> : null}
      <div className="flex gap-2" aria-live="polite">
        <button type="submit" disabled={isSaving} className={actionClass}>{isSaving ? 'Saving resource...' : 'Save changes'}</button>
        <button type="button" disabled={isSaving} onClick={onCancel} className={actionClass}>Cancel</button>
      </div>
    </form>
  )
}
