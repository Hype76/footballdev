import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useAuth } from '../lib/auth.js'

export function ParentPortalPage() {
  const { user } = useAuth()
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const selectedLink = links.find((link) => link.id === selectedLinkId)
    ?? links.find((link) => link.id === user?.selectedParentLinkId)
    ?? links[0]
  const otherLinks = links.filter((link) => link.id !== selectedLink?.id)

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Parent Portal"
        title={selectedLink?.playerName || 'My Child'}
        description="Parent access only shows linked child information. Coaching and club tools are not available in this view."
      />

      <SectionCard title="Linked child" description="This is the child and team currently linked to your parent portal.">
        {selectedLink ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard label="Child" value={selectedLink.playerName} />
            <InfoCard label="Team" value={selectedLink.teamName || 'No team entered'} />
            <InfoCard label="Club" value={selectedLink.clubName || 'No club entered'} />
            <InfoCard label="Section" value={selectedLink.playerSection || 'Not recorded'} />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No child links are active for this parent account.
          </p>
        )}
      </SectionCard>

      {otherLinks.length > 0 ? (
        <SectionCard title="Other child links" description="If this email is linked to more than one child or team, select a child to view their details.">
          <div className="space-y-2">
            {otherLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => setSelectedLinkId(link.id)}
                className="block w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-left transition hover:border-[var(--accent)] hover:bg-[var(--panel-soft)]"
              >
                <p className="text-sm font-semibold text-[var(--text-primary)]">{link.playerName}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{link.teamName || 'No team'} | {link.clubName || 'No club'}</p>
              </button>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
