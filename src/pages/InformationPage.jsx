import { InfoCard, PlanCard, QuickLinks, RoleCard } from '../components/information/InformationCards.jsx'
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
import { formatLimit, planGuides, platformAdminGuide, roleGuides } from '../lib/information-guides.js'
import { getRoleQuickLinks } from '../lib/role-quick-links.js'

const testSiteReleaseNotes = [
  {
    title: 'Staging site and test safety',
    items: [
      'Created the staging workflow on the test branch so changes can be reviewed before live release.',
      'Added the red test-site banner across the top of the staging site.',
      'Disabled payment checkout on the test environment while keeping live payments separate.',
      'Allowed test club and team setup without checkout so testers can create workspaces quickly.',
    ],
  },
  {
    title: 'Platform administration',
    items: [
      'Added platform admin access from the workspace switcher.',
      'Added platform admin staff creation for trusted platform operators.',
      'Added club and team management tools for platform admins.',
      'Improved platform billing tools for tester access codes, promotions, and coupon management.',
    ],
  },
  {
    title: 'Workspace and role switching',
    items: [
      'Added switching between platform admin, club admin, and team views from one account.',
      'Added support for club admins to work inside team views without needing separate email accounts.',
      'Improved linked club and team handling so workspace options stay available when switching views.',
      'Added clearer role-specific next actions for setup and onboarding.',
    ],
  },
  {
    title: 'Testing and onboarding',
    items: [
      'Added guided walkthrough tips for key pages.',
      'Moved walkthrough tips into the page layout so the header and page content stay aligned.',
      'Added role-specific quick links and setup guidance.',
      'Added user settings controls for restarting or hiding walkthroughs.',
    ],
  },
  {
    title: 'Player and coach workflow',
    items: [
      'Added staff voice notes and changed voice note actions to mic icons.',
      'Refined player, session, and assessment page layouts for clearer daily use.',
      'Improved archive, activity, and form-builder workflows during the UX pass.',
      'Kept player work tied to the active team view where the user has team access.',
    ],
  },
  {
    title: 'Email and reporting',
    items: [
      'Added parent email template controls behind the correct plan and role access.',
      'Improved parent email sending from assessment and player profile workflows.',
      'Added sender copies on outgoing parent emails where the sender email is valid.',
      'Kept email sending disabled for demo accounts.',
    ],
  },
  {
    title: 'Code and maintainability',
    items: [
      'Split large page logic into smaller utility modules.',
      'Extracted platform admin statistics helpers.',
      'Extracted session page utilities.',
      'Cleaned up staging UX structure after the deeper review pass.',
    ],
  },
]

function ReleaseNotesSection() {
  return (
    <SectionCard
      title="Test site release notes"
      description="Summary of the staging work completed so far before live release."
    >
      <div id="release-notes" className="grid gap-4 xl:grid-cols-2">
        {testSiteReleaseNotes.map((release) => (
          <InfoCard key={release.title} title={release.title}>
            <ul className="space-y-2">
              {release.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </InfoCard>
        ))}
      </div>
    </SectionCard>
  )
}

export function InformationPage() {
  const { user } = useAuth()
  const currentPlanName = getPlanName(user)
  const currentRank = Number(user?.roleRank ?? 0)
  const currentPlanKey = String(user?.planKey ?? '').trim()
  const canUseBilling = canViewBilling(user)
  const canUseParentEmail = hasPlanFeature(user, 'parentEmail')
  const canUseTemplates = canManageParentEmailTemplates(user)
  const canUseStaffManagement = canManageUsers(user)
  const canAccessPlatformFeedback = canViewPlatformFeedback(user)
  const quickLinks = getRoleQuickLinks(user)
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
          <QuickLinks links={quickLinks} />
        </SectionCard>

        <ReleaseNotesSection />
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
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-5 py-4">
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
            Plans with parent email can use club templates and email parents from the player profile or assessment flow.
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
          <InfoCard title="Email sharing">
            {canUseParentEmail
              ? 'Parent email sending is enabled for this plan and depends on available templates.'
              : 'Parent email sending is an upgrade feature. The live assessment preview remains available.'}
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
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
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
        <QuickLinks links={quickLinks} />
      </SectionCard>

      <ReleaseNotesSection />
    </div>
  )
}
