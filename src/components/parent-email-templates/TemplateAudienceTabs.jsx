import { EMAIL_TEMPLATE_AUDIENCES } from '../../lib/email-templates.js'

export function TemplateAudienceTabs({ audience, onAudienceChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {[
        { key: EMAIL_TEMPLATE_AUDIENCES.parent, label: 'Parent Templates' },
        { key: EMAIL_TEMPLATE_AUDIENCES.player, label: 'Player Templates' },
      ].map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onAudienceChange(item.key)}
          className={`inline-flex min-h-11 items-center justify-center border px-4 py-3 text-sm font-bold transition ${
            audience === item.key
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
