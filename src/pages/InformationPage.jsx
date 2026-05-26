import { InfoCard, PlanCard, QuickLinks, VideoGuideGrid } from '../components/information/InformationCards.jsx'
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

const guideRules = [
  {
    label: 'Start with the next job',
    body: 'Use the links and videos to complete a real football task, not to browse a generic help centre.',
  },
  {
    label: 'Access depends on role',
    body: 'The guide only shows the tools this account can use inside the current club and plan.',
  },
  {
    label: 'Plan limits matter',
    body: 'Use the access panel before adding players, staff, messages, or development records.',
  },
]

const platformRules = [
  {
    label: 'Keep platform separate',
    body: 'Platform administration should not edit club player content unless support work requires it.',
  },
  {
    label: 'Use billing deliberately',
    body: 'Promotions, comped plans, and tier changes affect real club access.',
  },
  {
    label: 'Check the right workspace',
    body: 'Confirm the club context before changing platform settings or access.',
  },
]

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

    if (guide.key === 'development-fields') {
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
        <GuideHero
          eyebrow="Platform guide"
          title="Run platform support without mixing it into club football records."
          description="Use this as the control surface for administration rules, video guides, billing tools, and common platform destinations."
          metrics={[
            { label: 'Role', value: getRoleLabel(user) },
            { label: 'Guides', value: visibleVideoGuides.length },
            { label: 'Links', value: quickLinks.length },
            { label: 'Mode', value: 'Platform' },
          ]}
          rules={platformRules}
        />

        <SectionCard title="Platform responsibilities" description="Keep platform administration separate from club player content.">
          <div className="grid gap-4 md:grid-cols-2">
            {platformAdminGuide.map((item) => (
              <InfoCard key={item.title} title={item.title}>{item.body}</InfoCard>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Video guides" description="Short onboarding videos for platform administration tasks.">
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
      <GuideHero
        eyebrow="Workspace guide"
        title="Find the next football action for this role and plan."
        description={`Signed in as ${getRoleLabel(user)} on the ${currentPlanName} plan. Use this page to understand available tools, plan limits, and the fastest route back into setup work.`}
        metrics={[
          { label: 'Plan', value: currentPlanName },
          { label: 'Role', value: getRoleLabel(user) },
          { label: 'Videos', value: visibleVideoGuides.length },
          { label: 'Links', value: quickLinks.length },
        ]}
        rules={guideRules}
      />

      {isDemoAccount(user) ? (
        <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-5 py-4 shadow-sm shadow-[#2563eb]/10">
          <p className="text-sm font-black text-[#0f172a]">Demo workspace</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
            Demo users can explore the workspace and billing page. Destructive actions and account setting changes are blocked.
          </p>
        </div>
      ) : null}

      <SectionCard title="Current access" description="What this account can use right now.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard title="Plan">{currentPlanName}</InfoCard>
          <InfoCard title="Role">{getRoleLabel(user)}</InfoCard>
          <InfoCard title="Players">{formatLimit(getPlanLimit(user, 'players'))}</InfoCard>
          <InfoCard title="Monthly development records">{formatLimit(getPlanLimit(user, 'monthlyEvaluations'))}</InfoCard>
        </div>
      </SectionCard>

      <SectionCard title="Video guides" description="Short videos for the main tasks available to this role and plan.">
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

function GuideHero({ description, eyebrow, metrics, rules, title }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
      <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">{eyebrow}</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black leading-[1.04] tracking-tight text-[#0f172a] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475569]">{description}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {rules.map((rule) => (
              <div key={rule.label} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-4 shadow-sm shadow-[#2563eb]/10">
                <p className="text-sm font-black text-[#0f172a]">{rule.label}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{rule.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid content-between rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-5 shadow-sm shadow-[#2563eb]/10">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Current guide state</p>
            <p className="mt-2 break-words text-2xl font-black tracking-tight text-[#0f172a]">{metrics[0]?.value || 'Not set'}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
              The guide adapts to this account, role, plan, and workspace context.
            </p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {metrics.map((metric) => (
              <GuideMetric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function GuideMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#cbd5e1] bg-white px-4 py-4 shadow-sm shadow-[#2563eb]/10">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#2563eb]">{label}</p>
      <p className="mt-2 break-words text-2xl font-black text-[#0f172a]">{value}</p>
    </div>
  )
}
