import {
  EVALUATION_SECTIONS,
  PLAYER_CONTACT_TYPES,
  normalizeParentContacts,
} from '../../lib/supabase.js'
import { getDraftParentContacts } from '../../hooks/players/playerProfileUtils.js'
import { isInviteEmailTemplate } from '../../lib/email-templates.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlayerDetailsSection({
  directEmailSendingId,
  editingPlayerId,
  getDirectEmailTemplateOptions,
  getSelectedDirectEmailTemplateOption,
  isPromotingId,
  isSavingPlayer,
  onAddParentContact,
  onAddPlayerPosition,
  onCancelEditing,
  onMovePlayerToTrial,
  onParentContactDraftChange,
  onPlayerDraftChange,
  onPromotePlayer,
  onRemoveParentContact,
  onRemovePlayerPosition,
  onRefreshEmailTemplates,
  onSavePlayer,
  onSelectedDirectInviteDateChange,
  onSelectedDirectEmailTemplateChange,
  onSendDirectEmail,
  onStartEditingPlayer,
  playerDrafts,
  profilePlayers,
  selectedDirectInviteDates,
}) {
  return (
    <SectionCard
      title="Player details"
      description="Edit section, team, and parent contact details here."
    >
      {profilePlayers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
          No saved player details yet. This profile was created from assessment history.
        </div>
      ) : (
        <div className="space-y-4">
          {profilePlayers.map((player) => {
            const draft = playerDrafts[player.id] ?? player
            const isEditing = editingPlayerId === player.id
            const contacts = normalizeParentContacts(player.parentContacts, {
              parentName: player.parentName,
              parentEmail: player.parentEmail,
            })

            return (
              <div key={player.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                {isEditing ? (
                  <PlayerDetailsEditor
                    draft={draft}
                    isSavingPlayer={isSavingPlayer}
                    onAddParentContact={() => onAddParentContact(player.id)}
                    onAddPlayerPosition={() => onAddPlayerPosition(player.id)}
                    onCancelEditing={onCancelEditing}
                    onParentContactDraftChange={(index, fieldName, value) =>
                      onParentContactDraftChange(player.id, index, fieldName, value)
                    }
                    onPlayerDraftChange={(fieldName, value) => onPlayerDraftChange(player.id, fieldName, value)}
                    onRemoveParentContact={(index) => onRemoveParentContact(player.id, index)}
                    onRemovePlayerPosition={(position) => onRemovePlayerPosition(player.id, position)}
                    onSavePlayer={() => onSavePlayer(player.id)}
                  />
                ) : (
                  <PlayerDetailsSummary
                    contacts={contacts}
                    directEmailSendingId={directEmailSendingId}
                    directEmailTemplates={getDirectEmailTemplateOptions(player)}
                    selectedDirectEmailTemplateKey={getSelectedDirectEmailTemplateOption(player)?.optionKey || ''}
                    selectedDirectInviteDate={selectedDirectInviteDates[player.id] || ''}
                    isPromoting={isPromotingId === player.id}
                    onMovePlayerToTrial={() => onMovePlayerToTrial(player.id)}
                    onPromotePlayer={() => onPromotePlayer(player.id)}
                    onRefreshEmailTemplates={onRefreshEmailTemplates}
                    onSelectedDirectInviteDateChange={(value) => onSelectedDirectInviteDateChange(player.id, value)}
                    onSelectedDirectEmailTemplateChange={(value) => onSelectedDirectEmailTemplateChange(player.id, value)}
                    onSendDirectEmail={() => onSendDirectEmail(player)}
                    onStartEditingPlayer={() => onStartEditingPlayer(player)}
                    player={player}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

function PlayerDetailsEditor({
  draft,
  isSavingPlayer,
  onAddParentContact,
  onAddPlayerPosition,
  onCancelEditing,
  onParentContactDraftChange,
  onPlayerDraftChange,
  onRemoveParentContact,
  onRemovePlayerPosition,
  onSavePlayer,
}) {
  const savingDisabledReason = isSavingPlayer ? 'Please wait while player details are being saved.' : undefined

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Name</span>
        <input
          value={draft.playerName}
          onChange={(event) => onPlayerDraftChange('playerName', event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
        <select
          value={draft.section}
          onChange={(event) => onPlayerDraftChange('section', event.target.value)}
          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
        >
          {EVALUATION_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {section}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Shirt Number</span>
        <input
          value={draft.shirtNumber ?? ''}
          onChange={(event) => onPlayerDraftChange('shirtNumber', event.target.value)}
          inputMode="numeric"
          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
        <input
          value={draft.team}
          onChange={(event) => onPlayerDraftChange('team', event.target.value)}
          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
        />
      </label>
      <div className="md:col-span-2 xl:col-span-3">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="block text-sm font-semibold text-[var(--text-primary)]">Contacts</span>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              Add parent or guardian contacts used for player communication.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddParentContact}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
          >
            Add Another Contact
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {getDraftParentContacts(draft).map((contact, index) => (
            <div key={index} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                Contact {index + 1}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Name</span>
                  <input
                    value={contact.name}
                    onChange={(event) => onParentContactDraftChange(index, 'name', event.target.value)}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Email</span>
                  <input
                    type="email"
                    value={contact.email}
                    onChange={(event) => onParentContactDraftChange(index, 'email', event.target.value)}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => onRemoveParentContact(index)}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
              >
                Remove Contact
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="md:col-span-2 xl:col-span-3">
        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Positions</span>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={draft.positionDraft ?? ''}
            onChange={(event) => onPlayerDraftChange('positionDraft', event.target.value)}
            placeholder="Add position"
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={onAddPlayerPosition}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
          >
            Add Position
          </button>
        </div>
        {(draft.positions ?? []).length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.positions.map((position) => (
              <button
                key={position}
                type="button"
                onClick={() => onRemovePlayerPosition(position)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
              >
                {position} remove
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">No positions entered.</p>
        )}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <button
          type="button"
          disabled={isSavingPlayer}
          title={savingDisabledReason}
          onClick={onSavePlayer}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          disabled={isSavingPlayer}
          title={savingDisabledReason}
          onClick={onCancelEditing}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function PlayerDetailsSummary({
  contacts,
  directEmailSendingId,
  directEmailTemplates,
  isPromoting,
  onMovePlayerToTrial,
  onPromotePlayer,
  onRefreshEmailTemplates,
  onSelectedDirectInviteDateChange,
  onSelectedDirectEmailTemplateChange,
  onSendDirectEmail,
  onStartEditingPlayer,
  player,
  selectedDirectInviteDate,
  selectedDirectEmailTemplateKey,
}) {
  const directEmailId = `direct:${player.id}`
  const selectedTemplateKey = String(selectedDirectEmailTemplateKey ?? '').split(':').pop()
  const shouldShowInviteDate = isInviteEmailTemplate(selectedTemplateKey)
  const directEmailDisabledReason = directEmailSendingId === directEmailId
    ? 'Please wait while this email is being sent.'
    : directEmailTemplates.length === 0
      ? 'Enable a Direct Email template before sending email from here.'
      : undefined
  const promotionDisabledReason = isPromoting ? 'Please wait while this player is being updated.' : undefined

  return (
    <div className="space-y-4">
      <div className="grid flex-1 gap-3 md:grid-cols-2 2xl:grid-cols-6">
        <PlayerDetailItem label="Section" value={player.section} />
        <PlayerDetailItem label="Team" value={player.team || 'No team entered'} />
        <PlayerDetailItem label="Shirt Number" value={player.shirtNumber || 'Not entered'} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Contacts</p>
          <div className="mt-2 space-y-1">
            {contacts.length > 0 ? (
              contacts.map((contact, index) => (
                <p key={index} className="break-words text-sm font-semibold text-[var(--text-primary)]">
                  {contact.name || (contact.type === PLAYER_CONTACT_TYPES.self ? 'Player' : 'Parent/Guardian')}{contact.email ? ` | ${contact.email}` : ''}
                </p>
              ))
            ) : (
              <p className="text-sm font-semibold text-[var(--text-primary)]">No contact details entered</p>
            )}
          </div>
        </div>
        <PlayerDetailItem
          label="Positions"
          value={player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
        />
        <PlayerDetailItem label="Status" value={player.status === 'promoted' ? 'Promoted' : 'Active'} />
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(160px,0.45fr)_auto_auto_auto] lg:items-end">
          {directEmailTemplates.length > 0 ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email template</span>
              <select
                value={selectedDirectEmailTemplateKey}
                onChange={(event) => onSelectedDirectEmailTemplateChange(event.target.value)}
                onFocus={onRefreshEmailTemplates}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {directEmailTemplates.map((template) => (
                  <option key={template.optionKey} value={template.optionKey}>
                    {template.audience === 'player' ? 'Player' : 'Parent'}: {template.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-muted)]">
              Enable a template for Direct Email before sending.
            </div>
          )}
          {shouldShowInviteDate ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Invite date</span>
              <input
                type="date"
                value={selectedDirectInviteDate}
                onChange={(event) => onSelectedDirectInviteDateChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          ) : (
            <div className="hidden lg:block" />
          )}
          <button
            type="button"
            onClick={onSendDirectEmail}
            disabled={directEmailSendingId === directEmailId || directEmailTemplates.length === 0}
            title={directEmailDisabledReason}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
          >
            {directEmailSendingId === directEmailId ? 'Sending...' : 'Send Email'}
          </button>
          {player.section === 'Squad' ? (
            <button
              type="button"
              disabled={isPromoting}
              title={promotionDisabledReason}
              onClick={onMovePlayerToTrial}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              {isPromoting ? 'Moving...' : 'Move to Trial'}
            </button>
          ) : (
            <button
              type="button"
              disabled={isPromoting}
              title={promotionDisabledReason}
              onClick={onPromotePlayer}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              {isPromoting ? 'Promoting...' : 'Promote to Squad'}
            </button>
          )}
          <button
            type="button"
            onClick={onStartEditingPlayer}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] lg:w-auto"
          >
            Edit Details
          </button>
        </div>
      </div>
    </div>
  )
}

function PlayerDetailItem({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
