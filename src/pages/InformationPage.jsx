import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  InfoCard,
  PlanCard,
  QuickLinks,
  VideoGuideCard,
} from '../components/information/InformationCards.jsx'
import {
  canManageFormFields,
  canManageUsers,
  canViewBilling,
  getRoleLabel,
  isDemoAccount,
  isSuperAdmin,
  useAuth,
} from '../lib/auth.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature } from '../lib/paywall-ui.js'
import { getPlanLimit, getPlanName } from '../lib/plans.js'
import { formatLimit, onboardingVideoGuides, planGuides, platformAdminGuide } from '../lib/information-guides.js'
import { getRoleQuickLinks } from '../lib/role-quick-links.js'

const guideRules = [
  {
    label: 'Start with the next action',
    body: 'Use the links and videos to complete a real football task, not to browse a generic help centre.',
  },
  {
    label: 'Access depends on role',
    body: 'The guide only shows the tools this account can use inside the current club and plan.',
  },
  {
    label: 'Plan limits matter',
    body: 'Use the access panel before adding players, Coaches, messages, or development records.',
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

const clubTopics = [
  { key: 'overview', label: 'Overview', description: 'Current access and next actions' },
  { key: 'videos', label: 'Video guides', description: 'One task guide at a time' },
  { key: 'plans', label: 'Plan guide', description: 'Limits and upgrade reasons' },
]

const platformTopics = [
  { key: 'overview', label: 'Overview', description: 'Responsibilities and quick links' },
  { key: 'videos', label: 'Video guides', description: 'Platform administration help' },
  { key: 'billing', label: 'Billing guidance', description: 'Promotions and tier changes' },
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
  const [searchParams, setSearchParams] = useSearchParams()
  const currentPlanName = getPlanName(user)
  const currentPlanKey = String(user?.planKey ?? '').trim()
  const platformMode = isSuperAdmin(user)
  const quickLinks = getRoleQuickLinks(user)
  const visibleVideoGuides = useMemo(() => getVisibleVideoGuides(user, {
    canUseAssessmentFields: canManageFormFields(user),
    canUseBilling: canViewBilling(user),
    canUseParentEmail: canUseUiFeature(user, CAPABILITIES.parentEmails),
    canUseStaffManagement: canManageUsers(user),
  }), [user])
  const topics = platformMode ? platformTopics : clubTopics
  const requestedTopic = searchParams.get('topic') || 'overview'
  const activeTopic = topics.some((topic) => topic.key === requestedTopic) ? requestedTopic : 'overview'

  function selectTopic(topic) {
    const next = new URLSearchParams()
    if (topic !== 'overview') {
      next.set('topic', topic)
    }
    setSearchParams(next)
  }

  function selectChild(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    setSearchParams(next)
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <GuideHero
        eyebrow={platformMode ? 'Platform guide' : 'Workspace guide'}
        title={platformMode ? 'Run platform support from one focused guide.' : 'Find the next football action for this role and plan.'}
        description={platformMode
          ? 'Choose a topic, complete the task, then return to the guide index.'
          : `Signed in as ${getRoleLabel(user)} on the ${currentPlanName} plan. Choose one topic to see only the guidance you need.`}
        metrics={platformMode
          ? [
              { label: 'Role', value: getRoleLabel(user) },
              { label: 'Guides', value: visibleVideoGuides.length },
              { label: 'Links', value: quickLinks.length },
            ]
          : [
              { label: 'Plan', value: currentPlanName },
              { label: 'Role', value: getRoleLabel(user) },
              { label: 'Videos', value: visibleVideoGuides.length },
              { label: 'Links', value: quickLinks.length },
            ]}
        rules={platformMode ? platformRules : guideRules}
      />

      <TopicNavigation topics={topics} activeTopic={activeTopic} onSelect={selectTopic} />

      {activeTopic === 'overview' ? (
        platformMode ? (
          <PlatformOverview quickLinks={quickLinks} />
        ) : (
          <ClubOverview user={user} currentPlanName={currentPlanName} quickLinks={quickLinks} />
        )
      ) : null}

      {activeTopic === 'videos' ? (
        <VideoWorkspace
          guides={visibleVideoGuides}
          selectedKey={searchParams.get('guide')}
          onSelect={(key) => selectChild('guide', key)}
        />
      ) : null}

      {activeTopic === 'plans' && !platformMode ? (
        <PlanWorkspace
          currentPlanKey={currentPlanKey}
          selectedKey={searchParams.get('plan')}
          onSelect={(key) => selectChild('plan', key)}
        />
      ) : null}

      {activeTopic === 'billing' && platformMode ? <PlatformBilling /> : null}
    </div>
  )
}

function TopicNavigation({ topics, activeTopic, onSelect }) {
  return (
    <nav aria-label="Information topics" className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-2 shadow-sm shadow-black/10">
      <div className="grid grid-cols-3 gap-2">
        {topics.map((topic) => {
          const isActive = topic.key === activeTopic
          return (
            <button
              key={topic.key}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(topic.key)}
              className={`min-h-16 rounded-lg border px-4 py-3 text-left transition ${
                isActive
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-muted)] hover:border-[var(--accent)]'
              }`}
            >
              <span className="block text-sm font-black">{topic.label}</span>
              <span className="mt-1 hidden text-xs font-semibold leading-5 sm:block">{topic.description}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function ClubOverview({ user, currentPlanName, quickLinks }) {
  return (
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm shadow-black/10 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">Current access</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">What this account can use now</h2>
        </div>
        {isDemoAccount(user) ? (
          <span className="inline-flex w-fit rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--accent)]">Demo workspace</span>
        ) : null}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GuideMetric label="Plan" value={currentPlanName} />
        <GuideMetric label="Role" value={getRoleLabel(user)} />
        <GuideMetric label="Players" value={formatLimit(getPlanLimit(user, 'players'))} />
        <GuideMetric label="Monthly records" value={formatLimit(getPlanLimit(user, 'monthlyEvaluations'))} />
      </div>
      {isDemoAccount(user) ? (
        <p className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--text-muted)]">
          Demo users can explore the workspace and billing page. Destructive actions and account setting changes are blocked.
        </p>
      ) : null}
      <div className="mt-5 border-t border-[var(--border-color)] pt-5">
        <h3 className="text-base font-black text-[var(--text-primary)]">Go to the next task</h3>
        <div className="mt-3"><QuickLinks links={quickLinks} compact /></div>
      </div>
    </section>
  )
}

function PlatformOverview({ quickLinks }) {
  return (
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm shadow-black/10 sm:p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">Platform responsibilities</p>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">Keep platform work separate from club records</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {platformAdminGuide.map((item) => <InfoCard key={item.title} title={item.title}>{item.body}</InfoCard>)}
      </div>
      <div className="mt-5 border-t border-[var(--border-color)] pt-5">
        <h3 className="text-base font-black text-[var(--text-primary)]">Platform destinations</h3>
        <div className="mt-3"><QuickLinks links={quickLinks} compact /></div>
      </div>
    </section>
  )
}

function VideoWorkspace({ guides, selectedKey, onSelect }) {
  const selectedGuide = guides.find((guide) => guide.key === selectedKey)

  if (selectedGuide) {
    return (
      <section className="space-y-4">
        <FocusedHeader eyebrow="Video guide" title={selectedGuide.title} onBack={() => onSelect('')} backLabel="Back to video guides" />
        <VideoGuideCard guide={selectedGuide} />
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm shadow-black/10 sm:p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">Video guides</p>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">Choose one task guide</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">The selected guide opens on its own, with a clear route back to this list.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {guides.map((guide) => (
          <button
            key={guide.key}
            type="button"
            onClick={() => onSelect(guide.key)}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-sm font-black text-[var(--text-primary)]">{guide.title}</span>
              <span className="shrink-0 text-xs font-black uppercase tracking-[0.1em] text-[var(--accent)]">{guide.duration}</span>
            </span>
            <span className="mt-2 block text-sm font-semibold leading-6 text-[var(--text-muted)]">{guide.caption}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function PlanWorkspace({ currentPlanKey, selectedKey, onSelect }) {
  const selectedPlan = planGuides.find((plan) => plan.key === selectedKey)

  if (selectedPlan) {
    return (
      <section className="space-y-4">
        <FocusedHeader eyebrow="Plan guide" title={selectedPlan.label} onBack={() => onSelect('')} backLabel="Back to plan list" />
        <PlanCard plan={selectedPlan} isCurrent={selectedPlan.key === currentPlanKey} />
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm shadow-black/10 sm:p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">Plan guide</p>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">Choose a plan to review</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {planGuides.map((plan) => (
          <button
            key={plan.key}
            type="button"
            onClick={() => onSelect(plan.key)}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-sm font-black text-[var(--text-primary)]">{plan.label}</span>
              {plan.key === currentPlanKey ? <span className="text-xs font-black uppercase tracking-[0.1em] text-[var(--accent)]">Current</span> : null}
            </span>
            <span className="mt-2 block text-sm font-semibold leading-6 text-[var(--text-muted)]">{plan.summary}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function PlatformBilling() {
  const items = [
    { title: 'Live promotion', body: 'In Billing Options, use Show Live to place one Stripe promotion on the public pricing cards. Checkout auto-applies that promotion while it is live.' },
    { title: 'Tier upgrades', body: 'When a club upgrades from Individual or Single Team, the billing payer is promoted to Club Admin so they can manage the larger workspace.' },
    { title: 'Tier drops', body: 'If a club drops to a lower tier and exceeds limits, existing data remains. New and restored records must stay within the new limit.' },
    { title: 'Comped plans', body: 'Comped plans pause billing collection where a Stripe subscription exists, while the club keeps the selected plan access.' },
  ]
  return (
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm shadow-black/10 sm:p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">Billing guidance</p>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)]">Change access deliberately</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">{items.map((item) => <InfoCard key={item.title} title={item.title}>{item.body}</InfoCard>)}</div>
    </section>
  )
}

function FocusedHeader({ backLabel, eyebrow, onBack, title }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 shadow-sm shadow-black/10 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-[var(--text-primary)]">{title}</h2>
      </div>
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-2 text-sm font-black text-[var(--text-primary)] hover:border-[var(--accent)]">{backLabel}</button>
    </div>
  )
}

function GuideHero({ description, eyebrow, metrics, rules, title }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-sm shadow-black/10">
      <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">{eyebrow}</p>
          <h1 className="mt-2 max-w-4xl text-3xl font-black leading-[1.08] tracking-tight text-[var(--text-primary)] sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[var(--text-muted)] sm:text-base">{description}</p>
          <details className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
            <summary className="cursor-pointer text-sm font-black text-[var(--text-primary)]">How to use this guide</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {rules.map((rule) => (
                <div key={rule.label}>
                  <p className="text-sm font-black text-[var(--text-primary)]">{rule.label}</p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-[var(--text-muted)]">{rule.body}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => <GuideMetric key={metric.label} label={metric.label} value={metric.value} />)}
        </div>
      </div>
    </section>
  )
}

function GuideMetric({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-3">
      <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-[var(--accent)]">{label}</p>
      <p className="mt-1 break-words text-lg font-black text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
