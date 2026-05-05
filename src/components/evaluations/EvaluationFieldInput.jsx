function isScoreFieldType(fieldType) {
  return fieldType === 'score_1_5' || fieldType === 'score_1_10' || fieldType === 'number'
}

function createScoreOptions(fieldType) {
  const maxValue = fieldType === 'score_1_10' ? 10 : 5
  return Array.from({ length: maxValue }, (_, index) => String(index + 1))
}

function getFieldSelectOptions(field) {
  if (field.type === 'select') {
    return field.options
  }

  if (isScoreFieldType(field.type)) {
    return createScoreOptions(field.type)
  }

  return []
}

const SCORE_HELP = [
  {
    label: 'Underperforming',
    description: 'The player is not meeting the expected standards in training or matches.',
  },
  {
    label: 'Needs Improvement',
    description: 'The player shows some awareness of expectations but is not consistently meeting them.',
  },
  {
    label: 'On Target',
    description: 'The player is performing at the expected level for their role.',
  },
  {
    label: 'Above Average',
    description: 'The player performs to a high standard and often goes beyond what is expected.',
  },
  {
    label: 'Exceeding Expectations',
    description: 'The player consistently performs above the expected level.',
  },
]

function getScoreHelpText() {
  return SCORE_HELP
    .map((help, index) => `${index + 1}. ${help.label}: ${help.description}`)
    .join('\n')
}

function ScoreInfo() {
  const helpText = getScoreHelpText()

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="Score information"
        title={helpText}
        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] text-sm font-bold text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus:border-[var(--accent)] focus:outline-none"
      >
        i
      </button>
      <span className="pointer-events-none absolute right-0 top-12 z-20 hidden w-80 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 text-left text-xs leading-5 text-[var(--text-primary)] shadow-xl shadow-black/20 group-hover:block group-focus-within:block">
        <span className="mb-3 block text-sm font-semibold text-[var(--text-primary)]">Scoring guide</span>
        {SCORE_HELP.map((help, index) => (
          <span key={help.label} className="mt-2 block">
            <span className="font-semibold text-[var(--text-primary)]">
              {index + 1}. {help.label}
            </span>
            <span className="mt-0.5 block text-[var(--text-muted)]">{help.description}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

export function EvaluationFieldInput({ field, value, onChange }) {
  const sharedClassName =
    'min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]'

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        rows="4"
        className="min-h-32 w-full rounded-3xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
      />
    )
  }

  if (field.type === 'select' || isScoreFieldType(field.type)) {
    const options = getFieldSelectOptions(field)
    const isScoreField = isScoreFieldType(field.type)

    return (
      <div className={isScoreField ? 'flex items-start gap-2' : ''}>
        <select
          value={value}
          onChange={(event) => onChange(field.id, event.target.value)}
          required={field.required}
          className={sharedClassName}
        >
          <option value="">{isScoreField ? 'Select score' : 'Select option'}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {isScoreField ? <ScoreInfo /> : null}
      </div>
    )
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(field.id, event.target.value)}
      required={field.required}
      className={sharedClassName}
    />
  )
}
