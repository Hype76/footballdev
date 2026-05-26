import { useState } from 'react'

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
    description: 'The player shows some awareness of expectations and is not consistently meeting them.',
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

function ScoreInfo() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="Score information"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        onBlur={() => setIsOpen(false)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white text-sm font-black text-[#067a46] transition hover:border-[#20a464] hover:bg-[#f0fdf6] focus:border-[#20a464] focus:ring-2 focus:ring-[#d7f8e5] focus:outline-none"
      >
        i
      </button>
      <span className={`pointer-events-none absolute right-0 top-12 z-20 w-80 rounded-lg border border-[#bddcca] bg-white p-4 text-left text-xs leading-5 text-[#456653] shadow-lg shadow-[#10231a]/10 group-hover:block group-focus-within:block ${isOpen ? 'block' : 'hidden'}`}>
        <span className="mb-3 block text-sm font-black text-[#10231a]">Scoring guide</span>
        {SCORE_HELP.map((help, index) => (
          <span key={help.label} className="mt-2 block">
            <span className="font-black text-[#10231a]">
              {index + 1}. {help.label}
            </span>
            <span className="mt-0.5 block text-[#456653]">{help.description}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

export function EvaluationFieldInput({ field, value, onChange }) {
  const sharedClassName =
    'min-h-11 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        rows="4"
        className="min-h-32 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
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
