import { EMAIL_TEMPLATE_AUDIENCES } from '../../lib/email-templates.js'

export function TemplateAudienceTabs({ audience, onAudienceChange }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm shadow-slate-200/70">
      <div className="grid gap-2 sm:grid-cols-2">
      {[
        { key: EMAIL_TEMPLATE_AUDIENCES.parent, label: 'Parent templates' },
        { key: EMAIL_TEMPLATE_AUDIENCES.player, label: 'Player templates' },
      ].map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onAudienceChange(item.key)}
          className={`inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-3 text-sm font-bold transition ${
            audience === item.key
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
          }`}
        >
          {item.label}
        </button>
      ))}
      </div>
    </div>
  )
}
