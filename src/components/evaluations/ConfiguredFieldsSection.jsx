import { EvaluationFieldInput } from './EvaluationFieldInput.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function ConfiguredFieldsSection({
  enabledFields,
  isFallbackFields,
  onResponseChange,
  responseValues,
}) {
  return (
    <SectionCard
      title="Configured fields"
      description={
        isFallbackFields
          ? 'No club-specific form fields were found, so the default assessment fields were loaded.'
          : 'These enabled fields come from Assessment Fields and are saved as form responses.'
      }
    >
      {enabledFields.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-600">
          No assessment fields are enabled for this club. Enable fields in Assessment Fields first.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {enabledFields.map((field) => (
            <label key={field.id} className={field.type === 'textarea' ? 'block md:col-span-2' : 'block'}>
              <span className="mb-2 block text-sm font-bold text-slate-950">
                {field.label}
                {field.required ? ' *' : ''}
              </span>
              <EvaluationFieldInput field={field} value={responseValues[field.id] ?? ''} onChange={onResponseChange} />
            </label>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
