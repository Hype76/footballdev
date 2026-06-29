import { useState } from 'react'
import {
  DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE,
  DEFAULT_ASSESSMENT_SCORE_GUIDE,
  getAssessmentScoreMax,
  getDefaultAssessmentScoreOptions,
  isAssessmentScoreFieldType,
} from '../../lib/assessment-scoring.js'

function isScoreFieldType(fieldType) {
  return isAssessmentScoreFieldType(fieldType)
}

function createScoreOptions(fieldType) {
  if (fieldType === DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE) {
    return getDefaultAssessmentScoreOptions()
  }

  const maxValue = getAssessmentScoreMax(fieldType)
  return Array.from({ length: maxValue }, (_, index) => {
    const value = String(index + 1)
    return { value, label: value }
  })
}

function getFieldSelectOptions(field) {
  if (field.type === 'select') {
    return (field.options ?? []).map((option) => {
      if (option && typeof option === 'object') {
        return {
          value: String(option.value ?? option.label ?? '').trim(),
          label: String(option.label ?? option.value ?? '').trim(),
        }
      }

      return {
        value: String(option ?? '').trim(),
        label: String(option ?? '').trim(),
      }
    }).filter((option) => option.value)
  }

  if (field.type === 'yes_no') {
    return [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ]
  }

  if (field.type === 'traffic_light') {
    return [
      { value: 'Green', label: 'Green' },
      { value: 'Amber', label: 'Amber' },
      { value: 'Red', label: 'Red' },
    ]
  }

  if (isScoreFieldType(field.type)) {
    return createScoreOptions(field.type)
  }

  return []
}

function ScoreInfo() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="Score information"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white text-sm font-black text-[#047857] transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:border-[#047857] focus:ring-2 focus:ring-[#d1fae5] focus:outline-none"
      >
        i
      </button>
      <span className={`absolute right-0 top-12 z-20 max-h-96 w-80 overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white p-4 text-left text-xs leading-5 text-[#4b5f55] shadow-lg shadow-[#101828]/10 group-hover:block group-focus-within:block ${isOpen ? 'block' : 'hidden'}`}>
        <span className="mb-3 block text-sm font-black text-[#101828]">Scoring guide</span>
        {DEFAULT_ASSESSMENT_SCORE_GUIDE.map((help) => (
          <span key={help.label} className="mt-2 block">
            <span className="font-black text-[#101828]">
              {help.score}. {help.label}
            </span>
            <span className="mt-0.5 block text-[#4b5f55]">{help.description}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

export function EvaluationFieldInput({ field, value, onChange }) {
  const sharedClassName =
    'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        rows="4"
        className="min-h-32 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]"
      />
    )
  }

  if (field.type === 'select' || field.type === 'yes_no' || field.type === 'traffic_light' || isScoreFieldType(field.type)) {
    const options = getFieldSelectOptions(field)
    const isScoreField = isScoreFieldType(field.type)
    const placeholder = field.type === 'yes_no'
      ? 'Select yes or no'
      : field.type === 'traffic_light'
        ? 'Select traffic light'
        : isScoreField
          ? 'Select score'
          : 'Select option'

    return (
      <div className={isScoreField ? 'flex items-start gap-2' : ''}>
        <select
          value={value}
          onChange={(event) => onChange(field.id, event.target.value)}
          required={field.required}
          className={sharedClassName}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {isScoreField ? <ScoreInfo /> : null}
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        className={sharedClassName}
      />
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
