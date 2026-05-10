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
          className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-3 text-sm font-semibold transition ${
            audience === item.key
              ? 'border-[var(--accent)] bg-[var(--button-primary)] text-[var(--button-primary-text)]'
              : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
