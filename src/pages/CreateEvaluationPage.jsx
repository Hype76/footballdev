import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useAuth } from '../lib/auth.js'
import { createEvaluation } from '../lib/supabase.js'

const ratingFields = [
  { key: 'technical', label: 'Technical' },
  { key: 'tactical', label: 'Tactical' },
  { key: 'physical', label: 'Physical' },
  { key: 'mentality', label: 'Mentality' },
  { key: 'coachability', label: 'Coachability' },
]

const strengthOptions = [
  { key: 'ballControl', label: 'Ball control' },
  { key: 'passingRange', label: 'Passing range' },
  { key: 'decisionMaking', label: 'Decision making' },
  { key: 'positioning', label: 'Positioning' },
  { key: 'workRate', label: 'Work rate' },
  { key: 'leadership', label: 'Leadership' },
]

function createInitialFormData(user) {
  return {
    team: user?.team || '',
    session: '',
    coachName: user?.name || '',
    playerName: '',
    parentEmail: '',
    scores: {
      technical: '',
      tactical: '',
      physical: '',
      mentality: '',
      coachability: '',
    },
    strengths: {
      ballControl: false,
      passingRange: false,
      decisionMaking: false,
      positioning: false,
      workRate: false,
      leadership: false,
    },
    comments: {
      strengths: '',
      improvements: '',
      overall: '',
    },
    decision: 'Progress',
  }
}

function normalizePlayerName(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function getAverageScore(scores) {
  const values = Object.values(scores)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value) && value > 0)

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function CreateEvaluationPage() {
  const { user } = useAuth()
  const [formData, setFormData] = useState(() => createInitialFormData(user))
  const [isSaved, setIsSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const averageScore = getAverageScore(formData.scores)

  useEffect(() => {
    setFormData(createInitialFormData(user))
  }, [user])

  useEffect(() => {
    if (!isSaved) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setIsSaved(false)
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [isSaved])

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleScoreChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setFormData((current) => ({
      ...current,
      scores: {
        ...current.scores,
        [name]: value,
      },
    }))
  }

  const handleStrengthChange = (event) => {
    const { name, checked } = event.target
    setIsSaved(false)
    setFormData((current) => ({
      ...current,
      strengths: {
        ...current.strengths,
        [name]: checked,
      },
    }))
  }

  const handleCommentChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setFormData((current) => ({
      ...current,
      comments: {
        ...current.comments,
        [name]: value,
      },
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const selectedStrengths = strengthOptions
        .filter((option) => formData.strengths[option.key])
        .map((option) => option.label)

      const evaluation = {
        playerName: normalizePlayerName(formData.playerName),
        team: String(user?.team || formData.team).trim(),
        coachId: user?.id,
        coach: String(user?.name || formData.coachName).trim(),
        parentEmail: formData.parentEmail.trim(),
        session: formData.session.trim(),
        date: new Date().toLocaleDateString(),
        scores: Object.fromEntries(
          Object.entries(formData.scores).map(([key, value]) => [key, Number(value)]),
        ),
        averageScore: averageScore !== null ? Number(averageScore.toFixed(1)) : null,
        comments: {
          strengths: formData.comments.strengths.trim(),
          improvements: formData.comments.improvements.trim(),
          overall: formData.comments.overall.trim(),
          selectedStrengths,
        },
        decision: formData.decision,
        status: 'Submitted',
        createdAt: new Date().toISOString(),
      }

      await createEvaluation(evaluation)
      setFormData(createInitialFormData(user))
      setIsSaved(true)
    } catch (error) {
      console.error(error)
      setIsSaved(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Evaluation"
        title="Create evaluation"
        description="Capture a fast team-based coaching review and save it locally."
      />

      {isSaved ? (
        <div className="rounded-[20px] border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#46604a]">
          Evaluation saved
        </div>
      ) : null}

      <form className="space-y-5 sm:space-y-6" onSubmit={handleSubmit}>
        <SectionCard
          title="Player details"
          description="Start with the team, coach, and player for this evaluation."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Team</span>
              <input
                type="text"
                name="team"
                value={formData.team}
                readOnly
                required
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm text-slate-900 outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Session</span>
              <input
                type="text"
                name="session"
                value={formData.session}
                onChange={handleFieldChange}
                placeholder="Saturday Trial - 12th April"
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Coach Name</span>
              <input
                type="text"
                name="coachName"
                value={formData.coachName}
                readOnly
                required
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm text-slate-900 outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Player Name</span>
              <input
                type="text"
                name="playerName"
                value={formData.playerName}
                onChange={handleFieldChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Parent Email</span>
              <input
                type="email"
                name="parentEmail"
                value={formData.parentEmail}
                onChange={handleFieldChange}
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>
          </div>
        </SectionCard>

        <SectionCard
          title="Ratings"
          description="Use the 1 to 5 scale for the core coaching scores."
        >
          <div className="mb-4 rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm font-semibold text-slate-700">
            Overall Score: {averageScore !== null ? averageScore.toFixed(1) : '-'}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ratingFields.map((field) => (
              <label key={field.key} className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">{field.label}</span>
                <select
                  name={field.key}
                  value={formData.scores[field.key]}
                  onChange={handleScoreChange}
                  required
                  className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                >
                  <option value="">Select rating</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Strengths"
          description="Mark the strongest parts of the player's current performance."
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {strengthOptions.map((option) => (
              <label
                key={option.key}
                className="flex min-h-11 items-center gap-3 rounded-2xl border border-[#dbe3d6] bg-[#fcfdfb] px-4 py-4 text-sm font-medium text-slate-700"
              >
                <input
                  type="checkbox"
                  name={option.key}
                  checked={formData.strengths[option.key]}
                  onChange={handleStrengthChange}
                  className="h-4 w-4 rounded border-[#bfcab8] text-slate-900"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Comments"
          description="Use direct, specific coaching language that is useful for the next session."
        >
          <div className="grid gap-4 lg:gap-5">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Strengths</span>
              <p className="mb-2 text-xs leading-5 text-slate-500">
                Example: Strong passing under pressure, good awareness in midfield
              </p>
              <textarea
                name="strengths"
                rows="4"
                value={formData.comments.strengths}
                onChange={handleCommentChange}
                className="min-h-32 w-full rounded-3xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Improvements</span>
              <p className="mb-2 text-xs leading-5 text-slate-500">
                Example: Needs to track runners more consistently when defending
              </p>
              <textarea
                name="improvements"
                rows="4"
                value={formData.comments.improvements}
                onChange={handleCommentChange}
                className="min-h-32 w-full rounded-3xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Overall</span>
              <textarea
                name="overall"
                rows="5"
                value={formData.comments.overall}
                onChange={handleCommentChange}
                required
                className="min-h-36 w-full rounded-3xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>
          </div>
        </SectionCard>

        <SectionCard
          title="Decision"
          description="Choose the current outcome for this evaluation."
        >
          <div className="grid gap-4 md:max-w-sm">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Decision</span>
              <select
                name="decision"
                value={formData.decision}
                onChange={handleFieldChange}
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Progress">Progress</option>
              </select>
            </label>
          </div>
        </SectionCard>

        <SectionCard
          title="Submit"
          description="This saves locally and keeps the workflow fast for multi-team coaching."
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 sm:w-auto"
            >
              {isSubmitting ? 'Saving...' : 'Submit Evaluation'}
            </button>
          </div>
        </SectionCard>
      </form>
    </div>
  )
}
