import { InfoCard, PlanCard, QuickLinks, VideoGuideGrid } from '../components/information/InformationCards.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import {
  canManageFormFields,
  canManageUsers,
  canViewBilling,
  getRoleLabel,
  isDemoAccount,
  isSuperAdmin,
  useAuth,
} from '../lib/auth.js'
import { getPlanLimit, getPlanName, hasPlanFeature } from '../lib/plans.js'
import { formatLimit, onboardingVideoGuides, planGuides, platformAdminGuide } from '../lib/information-guides.js'
import { getRoleQuickLinks } from '../lib/role-quick-links.js'

function getVisibleVideoGuides(user, access) {
  if (isSuperAdmin(user)) {
    return onboardingVideoGuides.filter((guide) => guide.key === 'platform-admin')
  }

  return onboardingVideoGuides.filter((guide) => {
    if (guide.key === 'platform-admin') {
      return false
    }

    if (guide.key === 'teams-staff') {
      return access.canUseStaffManagement
    }

    if (guide.key === 'assessment-fields') {
      return access.canUseAssessmentFields
    }

    if (guide.key === 'parent-email') {
      return access.canUseParentEmail
    }

    if (guide.key === 'billing') {
      return access.canUseBilling
    }

    return true
  })
}

export function InformationPage() {
  const { user } = useAuth()
  const currentPlanName = getPlanName(user)
  const currentPlanKey = String(user?.planKey ?? '').trim()
  const canUseBilling = canViewBilling(user)
  const canUseParentEmail = hasPlanFeature(user, 'parentEmail')
  const canUseAssessmentFields = canManageFormFields(user)
  const canUseStaffManagement = canManageUsers(user)
  const quickLinks = getRoleQuickLinks(user)
  const visibleVideoGuides = getVisibleVideoGuides(user, {
    canUseAssessmentFields,
    canUseBilling,
    canUseParentEmail,
    canUseStaffManagement,
  })

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

        <SectionCard title="Video walkthroughs" description="Short onboarding videos for platform administration tasks.">
          <VideoGuideGrid guides={visibleVideoGuides} />
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
              If a club drops to a lower tier and exceeds limits, they keep existing data. New records and restored records must stay within the new limit.
            </InfoCard>
            <InfoCard title="Comped plans">
              Comped plans pause billing collection where a Stripe subscription exists, while the club keeps the selected plan access.
            </InfoCard>
          </div>
        </SectionCard>

        <SectionCard title="Quick links" description="Common platform destinations.">
          <QuickLinks links={quickLinks} />
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Information"
        title="Football Player guide"
        description={`Signed in as ${getRoleLabel(user)} on the ${currentPlanName} plan.`}
      />

      {isDemoAccount(user) ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-black text-emerald-950">Demo workspace</p>
          <p className="mt-2 text-sm leading-6 text-emerald-900">
            Demo users can explore the workspace and billing page. Destructive actions and account setting changes are blocked.
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

      <SectionCard title="Video walkthroughs" description="Short videos for the main tasks available to this role and plan.">
        <VideoGuideGrid guides={visibleVideoGuides} />
      </SectionCard>

      <SectionCard title="Plan guide" description="Current plan restrictions and upgrade reasons.">
        <div className="grid gap-4 xl:grid-cols-2">
          {planGuides.map((plan) => (
            <PlanCard key={plan.key} plan={plan} isCurrent={plan.key === currentPlanKey} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Quick links" description="Common places to go next.">
        <QuickLinks links={quickLinks} />
      </SectionCard>
    </div>
  )
}
