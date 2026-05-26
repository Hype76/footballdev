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
      storageKey="development-record-fields-v2"
      title="Development fields"
      description={
        isFallbackFields
          ? 'No club-specific form fields were found, so the default development fields were loaded.'
          : 'These enabled fields come from Development Form and are saved as coach responses.'
      }
    >
      {enabledFields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-4 py-6 text-sm font-semibold text-[#5f7468] shadow-sm shadow-[#d7eadf]/60">
          No development fields are enabled for this club. Enable fields in Development Form first.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {enabledFields.map((field) => (
            <label key={field.id} className={field.type === 'textarea' ? 'block md:col-span-2' : 'block'}>
              <span className="mb-2 block text-sm font-black text-[#101828]">
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
