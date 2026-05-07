import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canViewPlatformFeedback, getRoleLabel, isSuperAdmin, useAuth } from '../lib/auth.js'

const roleGuides = [
  {
    key: 'admin',
    label: 'Club Admin',
    rank: 90,
    summary: 'Owns the club setup and controls the highest level club configuration.',
    capabilities: [
      'Manage club settings and club branding.',
      'Create and rename teams.',
      'Manage staff access for roles below Club Admin.',
      'View club users and role allocations.',
      'Review feedback from the club and send platform feedback.',
    ],
  },
  {
    key: 'head_manager',
    label: 'Team Admin',
    rank: 70,
    summary: 'Oversees managers, coaches, assessment structure, and player workflow.',
    capabilities: [
      'Manage staff access for Team Admin level and below.',
      'Configure assessment form fields in Form Builder.',
      'Create, edit, and review player records.',
      'Create sessions and assign players into training or match sessions.',
      'Assess players and export parent PDF or email templates.',
    ],
  },
  {
    key: 'manager',
    label: 'Manager',
    rank: 50,
    summary: 'Runs day to day football operations for assigned club workflows.',
    capabilities: [
      'Manage staff access for Manager level and below.',
      'Configure assessment form fields in Form Builder.',
      'Add Trial or Squad players.',
      'Create sessions and assess players.',
      'Edit assessments and export parent PDF or email templates.',
    ],
  },
  {
    key: 'coach',
    label: 'Coach',
    rank: 30,
    summary: 'Adds players, runs sessions, and completes assessments for assigned teams.',
    capabilities: [
      'Add players into Trial or Squad when assigned to a team.',
      'Open player profiles and review visible player history.',
      'Create session lists for matches or training.',
      'Complete player assessments from session lists or player profiles.',
      'Export parent PDFs and email templates where sharing is available.',
    ],
  },
  {
    key: 'assistant_coach',
    label: 'Assistant Coach',
    rank: 20,
    summary: 'Supports coaching workflow and player assessments for assigned teams.',
    capabilities: [
      'View assigned team players.',
      'Support session assessment notes and player reviews.',
      'Add or update player details where access allows.',
      'Open player profiles and review visible history.',
      'Use platform feedback to raise issues or improvement ideas.',
    ],
  },
  {
    key: 'other',
    label: 'Other Staff',
    rank: 10,
    summary: 'Limited club access based on the role created by club staff.',
    capabilities: [
      'Access only the areas made available to the assigned role.',
      'View relevant club information inside the workspace.',
      'Use platform feedback to request help or suggest improvements.',
    ],
  },
]

const platformAdminGuide = {
  label: 'Platform Admin',
  summary: 'Manages the platform without viewing child personal details.',
  capabilities: [
    'View platform usage statistics across clubs.',
    'Create, suspend, reactivate, and delete club workspaces.',
    'Review adult user emails for operational support.',
    'Review platform feedback, update status, add admin notes, and delete feedback items.',
    'Avoid accessing child names, parent contact details, or player assessment content.',
  ],
}

function StepCard({ number, title, children }) {
  return (
    <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Step {number}</p>
      <h3 className="mt-2 text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{children}</p>
    </div>
  )
}

function RoleCard({ guide }) {
  return (
    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{guide.label}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{guide.summary}</p>
      <div className="mt-4 space-y-2">
        {guide.capabilities.map((capability) => (
          <div key={capability} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
            <p className="text-sm leading-6 text-[var(--text-primary)]">{capability}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function InformationPage() {
  const { user } = useAuth()
  const currentRank = Number(user?.roleRank ?? 0)
  const canAccessPlatformFeedback = canViewPlatformFeedback(user)
  const visibleRoleGuides = isSuperAdmin(user)
    ? roleGuides
    : roleGuides.filter((guide) => guide.rank <= currentRank)
  const visibleGuides = canAccessPlatformFeedback
    ? visibleRoleGuides
    : visibleRoleGuides.map((guide) => ({
        ...guide,
        capabilities: guide.capabilities.filter(
          (capability) => !capability.toLowerCase().includes('platform feedback'),
        ),
      }))

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Information"
        title="How to use Football Operations"
        description={`Signed in as ${getRoleLabel(user)}. This guide only shows what is relevant to your access level and lower roles.`}
      />

      <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-5 py-4">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Instructions are a work in progress.</p>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
          This guide will keep improving as the platform workflow is tested and refined.
        </p>
      </div>

      {isSuperAdmin(user) ? (
        <SectionCard
          title="Platform admin guide"
          description="Platform admins manage clubs and platform feedback, not player assessment content."
        >
          <RoleCard guide={platformAdminGuide} />
        </SectionCard>
      ) : (
        <SectionCard
          title="Daily workflow"
          description="Use this flow to manage players, sessions, assessments, and parent-facing exports."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StepCard number="1" title="Add players">
              Start in Add Player. Add the player name, Trial or Squad section, team, positions, and one or more parent contacts.
            </StepCard>
            <StepCard number="2" title="Create sessions">
              Use Sessions to create a training or match session. Add players from your player list, then work through each player during or after the session.
            </StepCard>
            <StepCard number="3" title="Assess players">
              Open Assess Player from a session or player profile. Complete the configured form fields and save the assessment.
            </StepCard>
            <StepCard number="4" title="Review history">
              Open Players, then select a player to see their profile, ratings trend, field movement, details, and past assessments.
            </StepCard>
            <StepCard number="5" title="Share with parents">
              On the player profile, select the parent recipients, choose the email template, then download a scored PDF or email template PDF.
            </StepCard>
            {canAccessPlatformFeedback ? (
              <StepCard number="6" title="Raise feedback">
                Use Platform Feedback in the sidebar to suggest improvements. Other clubs can vote on feedback so the most useful ideas are easier to prioritise.
              </StepCard>
            ) : null}
          </div>
        </SectionCard>
      )}

      {!isSuperAdmin(user) ? (
        <SectionCard
          title="Role access"
          description="You can see your role and the roles below it. Higher club management permissions are intentionally hidden."
        >
          {visibleGuides.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
              No role guide is available for this account yet.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {visibleGuides.map((guide) => (
                <RoleCard key={guide.key} guide={guide} />
              ))}
            </div>
          )}
        </SectionCard>
      ) : null}

      <SectionCard
        title="Quick links"
        description="Common places to go next from this guide."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {!isSuperAdmin(user) ? (
            <>
              <Link
                to="/players"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
              >
                Open Players
              </Link>
              <Link
                to="/sessions"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
              >
                Open Sessions
              </Link>
            </>
          ) : (
            <Link
              to="/platform-admin"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
            >
              Open Platform Admin
            </Link>
          )}
          {canAccessPlatformFeedback ? (
            <Link
              to="/platform-feedback"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Open Platform Feedback
            </Link>
          ) : null}
        </div>
      </SectionCard>
    </div>
  )
}
