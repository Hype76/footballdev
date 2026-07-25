import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatPlatformDate } from '../../lib/platform-admin-stats.js'
import { StatusPill } from '../ui/StatusPill.jsx'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10'

function getStatus(invite) {
  if (invite.status === 'accepted') return 'accepted'
  if (invite.status === 'replaced') return 'replaced'
  if (invite.status === 'cancelled' || invite.status === 'revoked') return 'cancelled'
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) return 'expired'
  if (invite.deliveryStatus === 'provider_accepted') return 'sent'
  if (invite.deliveryStatus === 'failed') return 'failed'
  return 'unsent'
}

function EmptyState({ children }) {
  return <p className="rounded-lg border border-dashed border-[#d7e5dc] bg-white px-3 py-4 text-sm font-semibold text-[#4b5f55]">{children}</p>
}

function PersonCard({ person, actions = null }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-black text-[#101828]">{person.displayName || person.maskedEmail || 'Adult user'}</p>
          {person.maskedEmail ? <p className="mt-1 break-words text-sm font-semibold text-[#4b5f55]">{person.maskedEmail}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-2 py-1 text-xs font-black text-[#4b5f55]">{person.roleLabel}</span>
            <StatusPill status={person.status || 'active'} />
          </div>
          {person.assignedTeams?.length ? (
            <p className="mt-2 text-xs font-semibold text-[#4b5f55]">
              Teams: {person.assignedTeams.map((team) => team.name).filter(Boolean).join(', ')}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

function InviteCard({ invite, busyKey, onCancel, onReplace, showActions = true }) {
  const status = getStatus(invite)
  const isBusy = busyKey === invite.id

  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-black text-[#101828]">{invite.maskedEmail}</p>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{invite.roleLabel}</p>
          {invite.assignedTeams?.length ? (
            <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
              Teams: {invite.assignedTeams.map((team) => team.name).filter(Boolean).join(', ')}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-2 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55]">
              {status}
            </span>
            <span className="text-xs font-semibold text-[#4b5f55]">Sent: {formatPlatformDate(invite.sentAt)}</span>
            <span className="text-xs font-semibold text-[#4b5f55]">Expires: {formatPlatformDate(invite.expiresAt)}</span>
          </div>
        </div>
        {showActions ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={isBusy} onClick={() => onReplace(invite)} className={secondaryButtonClass}>
              Replace invitation
            </button>
            <button type="button" disabled={isBusy} onClick={() => onCancel(invite)} className={dangerButtonClass}>
              Cancel invitation
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ClubAccessManagement({ accessToken, club }) {
  const [access, setAccess] = useState(null)
  const [clubAdminEmail, setClubAdminEmail] = useState('')
  const [teamAdminEmail, setTeamAdminEmail] = useState('')
  const [selectedTeamIds, setSelectedTeamIds] = useState([])
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const request = useCallback(async (method, body = null) => {
    const url = method === 'GET'
      ? `/.netlify/functions/platform-club-access?clubId=${encodeURIComponent(club.id)}`
      : '/.netlify/functions/platform-club-access'
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken || ''}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok || result.success === false) {
      throw new Error(result.message || 'Club access could not be updated.')
    }

    return result
  }, [accessToken, club.id])

  const refresh = useCallback(async () => {
    setError('')

    try {
      const result = await request('GET')
      setAccess(result.access)
    } catch (requestError) {
      setError(requestError.message)
    }
  }, [request])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runAction = async (key, body, successMessage) => {
    setBusyKey(key)
    setError('')
    setMessage('')

    try {
      await request('POST', body)
      setMessage(successMessage)
      await refresh()
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setBusyKey('')
    }
  }

  const handleInviteClubAdmin = async (event) => {
    event.preventDefault()
    const saved = await runAction('invite-club-admin', {
      action: 'invite',
      clubId: club.id,
      email: clubAdminEmail,
      roleKey: 'admin',
    }, 'Club Admin access was added or an invitation was sent.')

    if (saved) setClubAdminEmail('')
  }

  const handleAssignTeamAdmin = async (event) => {
    event.preventDefault()

    if (selectedTeamIds.length === 0) {
      setError('Select at least one team.')
      return
    }

    const saved = await runAction('assign-team-admin', {
      action: 'invite',
      clubId: club.id,
      email: teamAdminEmail,
      roleKey: 'head_manager',
      teamIds: selectedTeamIds,
    }, 'Team Admin access was assigned or an invitation was sent.')

    if (saved) {
      setTeamAdminEmail('')
      setSelectedTeamIds([])
    }
  }

  const handleReplace = async (invite) => {
    if (!window.confirm(`Replace the pending ${invite.roleLabel} invitation for ${invite.maskedEmail}? The old invitation will stop working.`)) {
      return
    }

    await runAction(invite.id, {
      action: 'replace_invitation',
      inviteId: invite.id,
      roleKey: invite.role,
    }, 'The old invitation was superseded and one replacement invitation was sent.')
  }

  const handleCancel = async (invite) => {
    if (!window.confirm(`Cancel the ${invite.roleLabel} invitation for ${invite.maskedEmail}?`)) {
      return
    }

    await runAction(invite.id, {
      action: 'cancel_invitation',
      inviteId: invite.id,
      roleKey: invite.role,
    }, 'The invitation was cancelled.')
  }

  const handleRemove = async ({ person, assignmentType, teamId = '' }) => {
    const warning = assignmentType === 'club_admin'
      ? 'Removing Club Admin access can be critical. The final active administrator is protected and cannot be removed.'
      : 'Only the selected team assignment will be removed.'

    if (!window.confirm(`${warning}\n\nRemove ${person.roleLabel} access for ${person.maskedEmail}?`)) {
      return
    }

    await runAction(`${person.id}:${teamId}`, {
      action: 'remove',
      clubId: club.id,
      targetUserId: person.id,
      assignmentType,
      teamId,
    }, 'Access was removed without deleting the account or historical records.')
  }

  const handleRestore = async (removed) => {
    if (!window.confirm(`Restore ${removed.roleLabel} access${removed.teamName ? ` for ${removed.teamName}` : ''}?`)) {
      return
    }

    await runAction(removed.id, {
      action: 'restore',
      clubId: club.id,
      targetUserId: removed.targetUserId,
      assignmentType: removed.assignmentType,
      teamId: removed.teamId,
      historyId: removed.id,
    }, 'The removed assignment was restored.')
  }

  const activeAdministrators = useMemo(
    () => [access?.owner, ...(access?.clubAdmins || [])].filter(Boolean),
    [access],
  )

  return (
    <div className="mt-5 rounded-lg border border-[#a7d7bd] bg-[#ecfdf5]/60 p-4 sm:p-5">
      <div>
        <p className="text-base font-black text-[#101828]">Club access</p>
        <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
          Manage existing adult access without exposing authentication identifiers, invitation secrets, or child data.
        </p>
      </div>

      {error ? <p className="mt-4 rounded-lg border border-[#fecdca] bg-[#fff1f3] px-3 py-2 text-sm font-black text-[#b42318]">{error}</p> : null}
      {message ? <p className="mt-4 rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-sm font-black text-[#047857]">{message}</p> : null}

      {!access ? (
        <p className="mt-4 text-sm font-semibold text-[#4b5f55]">Loading club access...</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <form onSubmit={handleInviteClubAdmin} className={panelClass}>
              <p className="text-sm font-black text-[#101828]">Invite Club Admin</p>
              <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Existing accounts are assigned safely. New recipients receive one secure invitation.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input required type="email" value={clubAdminEmail} onChange={(event) => setClubAdminEmail(event.target.value)} placeholder="admin@example.com" className={fieldClass} />
                <button type="submit" disabled={Boolean(busyKey)} className={primaryButtonClass}>Invite Club Admin</button>
              </div>
            </form>

            <form onSubmit={handleAssignTeamAdmin} className={panelClass}>
              <p className="text-sm font-black text-[#101828]">Assign Team Admin</p>
              <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Select every intended team explicitly. No club-wide access is inferred.</p>
              <input required type="email" value={teamAdminEmail} onChange={(event) => setTeamAdminEmail(event.target.value)} placeholder="team.admin@example.com" className={`${fieldClass} mt-3`} />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(access.teams || []).map((team) => (
                  <label key={team.id} className="flex min-h-10 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828]">
                    <input
                      type="checkbox"
                      checked={selectedTeamIds.includes(team.id)}
                      onChange={(event) => setSelectedTeamIds((current) => event.target.checked
                        ? [...current, team.id]
                        : current.filter((id) => id !== team.id))}
                      className="h-4 w-4 accent-[#047857]"
                    />
                    {team.name}
                  </label>
                ))}
              </div>
              <button type="submit" disabled={Boolean(busyKey)} className={`${primaryButtonClass} mt-3`}>Assign Team Admin</button>
            </form>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className={panelClass}>
              <p className="text-sm font-black text-[#101828]">Owner</p>
              <div className="mt-3">
                {access.owner ? (
                  <PersonCard
                    person={access.owner}
                    actions={(
                      <button type="button" disabled={Boolean(busyKey)} onClick={() => handleRemove({ person: access.owner, assignmentType: 'club_admin' })} className={dangerButtonClass}>
                        Remove access
                      </button>
                    )}
                  />
                ) : <EmptyState>No active owner is recorded. A Club Admin must remain active.</EmptyState>}
              </div>
            </section>

            <section className={panelClass}>
              <p className="text-sm font-black text-[#101828]">Club Admins</p>
              <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Active administrators: {activeAdministrators.length}</p>
              <div className="mt-3 space-y-2">
                {(access.clubAdmins || []).length ? access.clubAdmins.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    actions={(
                      <button type="button" disabled={Boolean(busyKey)} onClick={() => handleRemove({ person, assignmentType: 'club_admin' })} className={dangerButtonClass}>
                        Remove access
                      </button>
                    )}
                  />
                )) : <EmptyState>No additional Club Admins.</EmptyState>}
              </div>
            </section>
          </div>

          <section className={panelClass}>
            <p className="text-sm font-black text-[#101828]">Team Administrators</p>
            <div className="mt-3 space-y-2">
              {(access.teamAdmins || []).length ? access.teamAdmins.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  actions={(person.assignedTeams || []).map((team) => (
                    <button key={team.id} type="button" disabled={Boolean(busyKey)} onClick={() => handleRemove({ person, assignmentType: 'team_admin', teamId: team.id })} className={dangerButtonClass}>
                      Remove {team.name}
                    </button>
                  ))}
                />
              )) : <EmptyState>No Team Admins.</EmptyState>}
            </div>
          </section>

          <section className={panelClass}>
            <p className="text-sm font-black text-[#101828]">Pending invitations</p>
            <div className="mt-3 space-y-2">
              {(access.pendingInvitations || []).length ? access.pendingInvitations.map((invite) => (
                <InviteCard key={`${invite.source}:${invite.id}`} invite={invite} busyKey={busyKey} onCancel={handleCancel} onReplace={handleReplace} />
              )) : <EmptyState>No pending invitations.</EmptyState>}
            </div>
            {(access.invitationHistory || []).length ? (
              <div className="mt-4 border-t border-[#d7e5dc] pt-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Recent invitation status</p>
                <div className="mt-3 space-y-2">
                  {access.invitationHistory.map((invite) => (
                    <InviteCard
                      key={`${invite.source}:${invite.id}`}
                      invite={invite}
                      busyKey={busyKey}
                      onCancel={handleCancel}
                      onReplace={handleReplace}
                      showActions={false}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className={panelClass}>
            <p className="text-sm font-black text-[#101828]">Removed access</p>
            <div className="mt-3 space-y-2">
              {(access.removedAccess || []).length ? access.removedAccess.map((removed) => (
                <div key={removed.id} className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-[#101828]">{removed.roleLabel}</p>
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                      {removed.teamName ? `Team: ${removed.teamName}. ` : ''}Removed: {formatPlatformDate(removed.removedAt)}
                    </p>
                  </div>
                  <button type="button" disabled={Boolean(busyKey)} onClick={() => handleRestore(removed)} className={secondaryButtonClass}>
                    Restore access
                  </button>
                </div>
              )) : <EmptyState>No removed assignments.</EmptyState>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
