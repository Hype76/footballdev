import {
  DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE,
  DEFAULT_ASSESSMENT_SCORE_GUIDE,
  getAssessmentScoreMax,
  getDefaultAssessmentScoreOptions,
  isAssessmentScoreFieldType,
} from '../../lib/assessment-scoring.js'
import { HintPopover } from '../ui/HintPopover.jsx'

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

function getScoreGuideItems(fieldType) {
  if (fieldType === DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE) {
    return DEFAULT_ASSESSMENT_SCORE_GUIDE
  }

  const maxValue = getAssessmentScoreMax(fieldType)
  return Array.from({ length: maxValue }, (_, index) => ({
    score: index + 1,
    label: `Score ${index + 1}`,
    description: `A ${index + 1} out of ${maxValue} score for this field.`,
  }))
}

function ScoreInfo({ field }) {
  const guideItems = getScoreGuideItems(field.type)
  const maxScore = getAssessmentScoreMax(field.type)

  return (
    <HintPopover
      buttonLabel={`Show scoring guide for ${field.label}`}
      title="Scoring guide"
    >
      <p className="text-sm font-semibold leading-6 text-[#4b5f55] dark:text-[#d7e5dc]">
        Use this guide when scoring {field.label}. Scores run from 1 to {maxScore}.
      </p>
      <div className="mt-3 grid gap-2">
        {guideItems.map((help) => (
          <div key={`${help.score}-${help.label}`} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 dark:border-[#315244] dark:bg-[#172033]">
            <p className="font-black text-[#101828] dark:text-white">
              {help.score}. {help.label}
            </p>
            <p className="mt-1 text-sm font-semibold leading-5 text-[#4b5f55] dark:text-[#d7e5dc]">{help.description}</p>
          </div>
        ))}
      </div>
    </HintPopover>
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
        {isScoreField ? <ScoreInfo field={field} /> : null}
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
