import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import {
  canManageParentEmailTemplates,
  canManageUsers,
  canViewBilling,
  canViewPlatformFeedback,
  getRoleLabel,
  isDemoAccount,
  isSuperAdmin,
  useAuth,
} from '../lib/auth.js'
import { getPlanLimit, getPlanName, hasPlanFeature } from '../lib/plans.js'

const roleGuides = [
  {
    key: 'admin',
    label: 'Club Admin',
    rank: 90,
    summary: 'Owns the club workspace, billing access, teams, staff access, and club settings.',
    capabilities: [
      'Create teams and manage club level setup.',
      'Manage users and roles below Club Admin.',
      'View billing and plan controls for the club.',
      'Use audit and activity views when the plan includes them.',
    ],
  },
  {
    key: 'head_manager',
    label: 'Team Admin',
    rank: 70,
    summary: 'Runs team level operations and can manage key settings for assigned football staff.',
    capabilities: [
      'Manage assigned team workflows, sessions, and assessments.',
      'Use Form Builder when the plan includes custom form fields.',
      'Manage parent email templates when parent email is included.',
      'View billing on Individual accounts and where club access allows it.',
    ],
  },
  {
    key: 'manager',
    label: 'Manager',
    rank: 50,
    summary: 'Handles player records, sessions, assessments, and parent communication workflows.',
    capabilities: [
      'Add players and maintain player details.',
      'Create sessions and work through assessment queues.',
      'Create and edit club parent email templates where the plan allows it.',
      'Restore archived players only when the active player limit still allows it.',
    ],
  },
  {
    key: 'coach',
    label: 'Coach',
    rank: 30,
    summary: 'Completes assessments and reviews visible player history for assigned teams.',
    capabilities: [
      'View assigned team players.',
      'Create assessments from sessions or player profiles.',
      'Use the live preview while assessing players.',
      'Download or email reports only when the plan includes those features.',
    ],
  },
  {
    key: 'assistant_coach',
    label: 'Assistant Coach',
    rank: 20,
    summary: 'Supports team workflow with limited access set by club managers.',
    capabilities: [
      'View assigned team information.',
      'Support player assessments where access allows it.',
      'Review visible player history.',
    ],
  },
]

const planGuides = [
  {
    key: 'individual',
    label: 'Individual',
    summary: 'Free team admin account for a single team workspace.',
    details: [
      'One team, one staff login, five active players, and ten assessments per month.',
      'Assessment preview is available, but PDF download and parent email sending are upgrade features.',
      'Billing is visible so the account can upgrade from the sidebar.',
    ],
  },
  {
    key: 'single_team',
    label: 'Single Team',
    summary: 'Paid plan for one team that needs sharing and form controls.',
    details: [
      'One team, three staff logins, and twenty active players.',
      'Includes PDF export, parent emails, parent email templates, and custom form fields.',
      'Parent emails include a small Player Feedback website advert.',
    ],
  },
  {
    key: 'small_club',
    label: 'Small Club',
    summary: 'Club plan for several teams and fuller management controls.',
    details: [
      'Up to ten teams with unlimited players and staff logins.',
      'Includes PDF export, parent emails, custom templates, custom branding, themes, and audit logs.',
      'Parent emails include a small Player Feedback website advert.',
    ],
  },
  {
    key: 'large_club',
    label: 'Large Club',
    summary: 'Expanded plan for larger organisations.',
    details: [
      'No standard team, staff, player, or monthly assessment limits.',
      'Includes the full club feature set.',
      'Used where the club needs a larger or custom operating model.',
    ],
  },
]

const platformAdminGuide = [
  {
    title: 'Club management',
    body: 'Create, suspend, reactivate, and delete club workspaces from Platform Admin. Player assessment content stays inside the club workspace.',
  },
  {
    title: 'Billing options',
    body: 'Create Stripe promotion codes, set one live website promotion, manage plan comping, and update club billing status.',
  },
  {
    title: 'Platform feedback',
    body: 'Review feedback from clubs, update statuses, add admin notes, and remove items that no longer need tracking.',
  },
  {
    title: 'Demo account',
    body: 'Demo data is reset and protected from destructive changes. Demo users can see billing for upgrade context, but cannot save restricted settings.',
  },
]

function InfoCard({ title, children }) {
  return (
    <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      <div className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{children}</div>
    </div>
  )
}

function DetailList({ items }) {
  return (
    <div className="mt-4 space-y-2">
      {items.map((item) => (
        <div key={item} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
          <p className="text-sm leading-6 text-[var(--text-primary)]">{item}</p>
        </div>
      ))}
    </div>
  )
}

function PlanCard({ plan, isCurrent }) {
  return (
    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{plan.label}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{plan.summary}</p>
        </div>
        {isCurrent ? (
          <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            Current
          </span>
        ) : null}
      </div>
      <DetailList items={plan.details} />
    </div>
  )
}

function RoleCard({ guide }) {
  return (
    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{guide.label}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{guide.summary}</p>
      <DetailList items={guide.capabilities} />
    </div>
  )
}

function formatLimit(value) {
  return value === null || value === undefined ? 'Unlimited' : String(value)
}

export function InformationPage() {
  const { user } = useAuth()
  const currentPlanName = getPlanName(user)
  const currentRank = Number(user?.roleRank ?? 0)
  const currentPlanKey = String(user?.planKey ?? '').trim()
  const canUseBilling = canViewBilling(user)
  const canUseParentEmail = hasPlanFeature(user, 'parentEmail')
  const canUsePdfExport = hasPlanFeature(user, 'pdfExport')
  const canUseTemplates = canManageParentEmailTemplates(user)
  const canUseStaffManagement = canManageUsers(user)
  const canAccessPlatformFeedback = canViewPlatformFeedback(user)
  const visibleRoleGuides = isSuperAdmin(user)
    ? roleGuides
    : roleGuides.filter((guide) => guide.rank <= currentRank)

  if (isSuperAdmin(user)) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Information"
          title="Platform guide"
          description="Current operating notes for platform administration."
        />

        <SectionCard title="Platform responsibilities" description="Keep platform administration separate from club player content.">
          <div className="grid gap-4 md:grid-cols-2">
            {platformAdminGuide.map((item) => (
              <InfoCard key={item.title} title={item.title}>{item.body}</InfoCard>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Billing and promotions" description="How billing tools are expected to work.">
          <div className="grid gap-4 md:grid-cols-2">
            <InfoCard title="Live promotion">
              In Billing Options, use Show Live to place one Stripe promotion on the public pricing cards. Checkout auto-applies that promotion while it is live.
            </InfoCard>
            <InfoCard title="Tier upgrades">
              When a club upgrades from Individual or Single Team, the billing payer is promoted to Club Admin so they can manage the larger workspace.
            </InfoCard>
            <InfoCard title="Tier drops">
              If a club drops to a lower tier and exceeds limits, they keep existing data but cannot add or restore records that would exceed the new limit.
            </InfoCard>
            <InfoCard title="Comped plans">
              Comped plans pause billing collection where a Stripe subscription exists, while the club keeps the selected plan access.
            </InfoCard>
          </div>
        </SectionCard>

        <SectionCard title="Quick links" description="Common platform destinations.">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/platform-admin" className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90">
              Open Platform Admin
            </Link>
            <Link to="/platform-billing-options" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]">
              Open Billing Options
            </Link>
            <Link to="/platform-feedback" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]">
              Open Platform Feedback
            </Link>
          </div>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Information"
        title="Player Feedback guide"
        description={`Signed in as ${getRoleLabel(user)} on the ${currentPlanName} plan.`}
      />

      {isDemoAccount(user) ? (
        <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-5 py-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Demo workspace</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            Demo users can explore the workspace and billing page, but destructive actions and account setting changes are blocked.
          </p>
        </div>
      ) : null}

      <SectionCard title="Current access" description="What this account can use right now.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard title="Plan">{currentPlanName}</InfoCard>
          <InfoCard title="Role">{getRoleLabel(user)}</InfoCard>
          <InfoCard title="Players">{formatLimit(getPlanLimit(user, 'players'))}</InfoCard>
          <InfoCard title="Monthly assessments">{formatLimit(getPlanLimit(user, 'monthlyEvaluations'))}</InfoCard>
        </div>
      </SectionCard>

      <SectionCard title="Daily workflow" description="The usual order for running player feedback.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <InfoCard title="1. Set up teams and staff">
            Club Admins create teams. Managers and Team Admins allocate staff based on the club plan and role limits.
          </InfoCard>
          <InfoCard title="2. Configure assessment fields">
            Use Form Builder to control the fields coaches complete. This is available from Single Team upward.
          </InfoCard>
          <InfoCard title="3. Add players">
            Add players with their team, section, positions, and parent contacts. Archived players do not count as active players until restored.
          </InfoCard>
          <InfoCard title="4. Create sessions">
            Build training or match sessions, add players, then assess from the session queue.
          </InfoCard>
          <InfoCard title="5. Assess and preview">
            Complete the assessment form and use the live preview. Individual accounts can preview even though exports are locked.
          </InfoCard>
          <InfoCard title="6. Share reports">
            Paid plans can download PDFs. Plans with parent email can use club templates and email parents from the player profile or assessment flow.
          </InfoCard>
        </div>
      </SectionCard>

      <SectionCard title="Plan guide" description="Current plan restrictions and upgrade reasons.">
        <div className="grid gap-4 xl:grid-cols-2">
          {planGuides.map((plan) => (
            <PlanCard key={plan.key} plan={plan} isCurrent={plan.key === currentPlanKey} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Feature notes" description="Important details that affect day to day use.">
        <div className="grid gap-4 md:grid-cols-2">
          <InfoCard title="Billing">
            {canUseBilling
              ? 'Billing is available from the sidebar. Individual users can see upgrade options even though the free tier has no charge.'
              : 'Billing is only visible to the highest permitted role for the current plan.'}
          </InfoCard>
          <InfoCard title="Parent email templates">
            {canUseTemplates
              ? 'Managers and above can create separate club templates for parent email types. Templates use fields such as {playerName}, {teamName}, and {summary}.'
              : canUseParentEmail
                ? 'Parent email templates are club templates. Ask a Manager, Team Admin, or Club Admin to create them.'
                : 'Parent email templates are available on tiers that include parent email.'}
          </InfoCard>
          <InfoCard title="PDF and email sharing">
            {canUsePdfExport
              ? 'PDF export is enabled for this plan. Parent email sending depends on the parent email feature and available templates.'
              : 'PDF download and parent email sending are upgrade features. The live assessment preview remains available.'}
          </InfoCard>
          <InfoCard title="Archived players">
            Restoring an archived player checks the current active player limit. If the club is already at the limit, restore is blocked until space is available.
          </InfoCard>
          <InfoCard title="Staff management">
            {canUseStaffManagement
              ? 'This role can manage users within the limits of the plan and cannot assign roles above its own access.'
              : 'Ask a Manager, Team Admin, or Club Admin to change staff access.'}
          </InfoCard>
          <InfoCard title="Platform feedback">
            {canAccessPlatformFeedback
              ? 'Use Platform Feedback to suggest improvements or report issues. Demo users cannot see platform feedback.'
              : 'Platform feedback is hidden for this account.'}
          </InfoCard>
        </div>
      </SectionCard>

      <SectionCard title="Role access" description="Roles shown here are your role and lower roles. Higher roles are hidden unless you have them.">
        {visibleRoleGuides.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No role guide is available for this account yet.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleRoleGuides.map((guide) => (
              <RoleCard key={guide.key} guide={guide} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Quick links" description="Common places to go next.">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link to="/players" className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90">
            Open Players
          </Link>
          <Link to="/sessions" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]">
            Open Sessions
          </Link>
          {canUseBilling ? (
            <Link to="/billing" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]">
              Open Billing
            </Link>
          ) : null}
          {canAccessPlatformFeedback ? (
            <Link to="/platform-feedback" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]">
              Open Platform Feedback
            </Link>
          ) : null}
        </div>
      </SectionCard>
    </div>
  )
}
