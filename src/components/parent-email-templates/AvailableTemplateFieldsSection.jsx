import { EMAIL_TEMPLATE_FIELDS } from '../../lib/email-templates.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function AvailableTemplateFieldsSection() {
  return (
    <SectionCard
      title="Available fields"
      description="Only these fields can be used inside a subject or body."
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {EMAIL_TEMPLATE_FIELDS.map((field) => (
          <div key={field.key} className="border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-bold text-slate-950">{field.label}</p>
            <p className="mt-1 font-mono text-xs font-semibold text-emerald-700">{`{${field.key}}`}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
